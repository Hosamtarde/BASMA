import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { DomainError } from '../../../shared/errors/domain-error';
import { markReplay, requireIdempotencyKey } from '../../../shared/http/idempotency';
import { ParseIdPipe } from '../../../shared/http/parse-id.pipe';
import { Permission } from '../../identity/domain/permissions';
import { CurrentUser, RequirePermission } from '../../identity/presentation/auth.decorators';
import type { AuthUser } from '../../identity/presentation/auth.decorators';
import { InvoiceTemplateService } from '../application/invoice-template.service';
import { CreateInvoiceInput, InvoiceDetail, InvoicesService } from '../application/invoices.service';
import type { InvoiceRow } from '../infrastructure/invoices.repository';
import {
  CreateInvoiceRequest,
  EligibleCasePage,
  EligibleCasesQuery,
  InvoiceListItemResponse,
  InvoiceListQuery,
  InvoicePage,
  InvoicePreviewResponse,
  InvoiceResponse,
  InvoiceSummaryResponse,
  InvoiceTemplateResponse,
  SaveInvoiceTemplateRequest,
  VoidInvoiceRequest,
} from './dto';

const toListItem = (r: InvoiceRow): InvoiceListItemResponse => ({
  id: r.id,
  no: r.no,
  type: r.type,
  status: r.status,
  issueDate: r.issueDate,
  language: r.language,
  currencyCode: r.currencyCode,
  doctorId: r.doctorId,
  partyName: r.partyName,
  subtotal: r.subtotal,
  discount: r.discount,
  total: r.total,
  voidReason: r.voidReason,
  voidedAt: r.voidedAt?.toISOString() ?? null,
  rowVersion: r.rowVersion,
  createdAt: r.createdAt.toISOString(),
});

const toResponse = (d: InvoiceDetail): InvoiceResponse => ({
  ...toListItem(d),
  snapshotVersion: d.snapshotVersion,
  snapshotSha256: d.snapshotSha256,
  snapshot: d.snapshot as unknown as Record<string, unknown>,
});

const definedOnly = <T extends object>(o: T): T =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null)) as T;

/** Issuing a type needs what it shows: cases and balances (cases), the ledger (statement, cases). */
function requireForType(user: AuthUser, type: CreateInvoiceInput['type']): void {
  const needed =
    type === 'cases' ? [Permission.CasesRead, Permission.LedgerRead] : type === 'statement' ? [Permission.LedgerRead] : [];
  if (needed.some((p) => !user.permissions.includes(p))) {
    throw new DomainError('error.auth.forbidden', HttpStatus.FORBIDDEN);
  }
}

const toInput = (b: CreateInvoiceRequest): CreateInvoiceInput =>
  definedOnly({
    type: b.type,
    doctorId: b.doctorId,
    caseIds: b.caseIds,
    expectedTotal: b.expectedTotal,
    notes: b.notes,
    from: b.from,
    to: b.to,
    partyName: b.partyName,
    reason: b.reason,
    amount: b.amount,
    language: b.language,
  });

const KEY_HEADER = {
  name: 'Idempotency-Key',
  required: true,
  description: 'A UUID per attempt; a replay returns the original invoice (200) instead of a duplicate',
};

/**
 * Invoices (SPEC §5.14, B6). Issued documents are immutable: the response carries the frozen snapshot and its
 * SHA-256; the web renders it and never computes a figure of its own beyond the totals check.
 */
@ApiTags('invoices')
@ApiBearerAuth()
@Controller('invoices')
export class InvoicesController {
  constructor(private readonly service: InvoicesService) {}

  @Get('eligible-cases')
  @RequirePermission(Permission.InvoicesRead)
  @ApiOperation({ summary: '«حالات منجزة غير مفوترة» of a doctor: delivered or ready, not on an active invoice' })
  @ApiOkResponse({ type: EligibleCasePage })
  @ApiNotFoundResponse({ description: 'error.not_found (doctor)' })
  async eligible(@Query() q: EligibleCasesQuery, @CurrentUser() user: AuthUser): Promise<EligibleCasePage> {
    requireForType(user, 'cases');
    const r = await this.service.eligible(q.doctorId, q.page, q.pageSize);
    return {
      page: r.page,
      pageSize: r.pageSize,
      total: r.total,
      doctor: r.doctor,
      items: r.items.map((c) => ({
        caseId: c.id,
        caseNo: c.caseNo,
        patientName: c.patientName,
        receivedDate: c.receivedDate,
        deliveredDate: c.deliveredDate,
        status: c.status,
        total: c.total,
        paid: c.paid,
        remaining: c.remaining,
      })),
    };
  }

  @Get('summary')
  @RequirePermission(Permission.InvoicesRead)
  @ApiOperation({ summary: 'Active documents per type and voided count (Home «الفواتير»)' })
  @ApiOkResponse({ type: InvoiceSummaryResponse })
  async summary(): Promise<InvoiceSummaryResponse> {
    return this.service.summary();
  }

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(Permission.InvoicesWrite)
  @ApiOperation({ summary: 'The snapshot an invoice would freeze, without a number and without writing anything' })
  @ApiOkResponse({ type: InvoicePreviewResponse })
  @ApiBadRequestResponse({ description: 'error.validation.failed | error.invoice.*' })
  @ApiConflictResponse({ description: 'error.invoice.case_*' })
  async preview(@Body() body: CreateInvoiceRequest, @CurrentUser() user: AuthUser): Promise<InvoicePreviewResponse> {
    requireForType(user, body.type);
    return { snapshot: (await this.service.preview(toInput(body))) as unknown as Record<string, unknown> };
  }

  @Post()
  @RequirePermission(Permission.InvoicesWrite)
  @ApiOperation({ summary: 'Issue an invoice (cases), a statement or a free invoice; the snapshot is frozen' })
  @ApiHeader(KEY_HEADER)
  @ApiCreatedResponse({ type: InvoiceResponse })
  @ApiOkResponse({ type: InvoiceResponse, description: 'Replay of an earlier request with the same key' })
  @ApiBadRequestResponse({
    description:
      'error.validation.failed | error.idempotency.required | error.invoice.field_required | field_not_allowed | party_required | case_count | case_duplicate | range_invalid | statement_too_long',
  })
  @ApiNotFoundResponse({ description: 'error.not_found (doctor or case)' })
  @ApiConflictResponse({
    description: 'error.invoice.case_already_invoiced | case_not_eligible | case_doctor_mismatch | total_changed',
  })
  @ApiUnprocessableEntityResponse({ description: 'error.idempotency.mismatch' })
  async create(
    @Body() body: CreateInvoiceRequest,
    @Headers('idempotency-key') keyHeader: string | undefined,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<InvoiceResponse> {
    requireForType(user, body.type);
    const key = requireIdempotencyKey(keyHeader);
    const result = await this.service.create(toInput(body), key, user.id);
    markReplay(res, result.replayed);
    return toResponse(result.invoice);
  }

  @Get()
  @RequirePermission(Permission.InvoicesRead)
  @ApiOperation({ summary: 'Invoices, newest first; filters: type, status, doctor, issue dates, number or party' })
  @ApiOkResponse({ type: InvoicePage })
  async list(@Query() q: InvoiceListQuery): Promise<InvoicePage> {
    const { page, pageSize, ...filter } = q;
    const r = await this.service.list(definedOnly(filter), page, pageSize);
    return { ...r, items: r.items.map(toListItem) };
  }

  @Get(':id')
  @RequirePermission(Permission.InvoicesRead)
  @ApiOperation({ summary: 'One invoice with its frozen snapshot (its SHA-256 is verified on every read)' })
  @ApiOkResponse({ type: InvoiceResponse })
  @ApiNotFoundResponse({ description: 'error.not_found' })
  async get(@Param('id', ParseIdPipe) id: number): Promise<InvoiceResponse> {
    return toResponse(await this.service.get(id));
  }

  @Get(':id/logo')
  @RequirePermission(Permission.InvoicesRead)
  @ApiOperation({ summary: 'The lab logo frozen into this invoice (404 = printed with the lab name only)' })
  @ApiProduces('image/png', 'image/jpeg')
  @ApiOkResponse({ description: 'Image bytes' })
  @ApiNotFoundResponse({ description: 'error.not_found' })
  async logo(@Param('id', ParseIdPipe) id: number, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const img = await this.service.logo(id);
    // Content-addressed and never changed: safe to cache privately for good.
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.setHeader('ETag', `"${img.sha256}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(img.content, { type: img.mimeType, length: img.sizeBytes });
  }

  @Post(':id/void')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(Permission.InvoicesVoid)
  @ApiOperation({ summary: 'Void with a reason (never delete); its cases become un-invoiced; number and snapshot stay' })
  @ApiOkResponse({ type: InvoiceResponse })
  @ApiNotFoundResponse({ description: 'error.not_found' })
  @ApiConflictResponse({ description: 'error.invoice.already_void | error.concurrency.stale' })
  async void(
    @Param('id', ParseIdPipe) id: number,
    @Body() body: VoidInvoiceRequest,
    @CurrentUser() user: AuthUser,
  ): Promise<InvoiceResponse> {
    return toResponse(await this.service.void(id, body.rowVersion, body.reason, user.id));
  }
}

/** «مظهر الفاتورة» (SPEC §5.15): read with settings.read, save with settings.write. */
@ApiTags('settings')
@ApiBearerAuth()
@Controller('settings/invoice-template')
export class InvoiceTemplateController {
  constructor(private readonly service: InvoiceTemplateService) {}

  @Get()
  @RequirePermission(Permission.SettingsRead)
  @ApiOperation({ summary: 'The invoice appearance (defaults with rowVersion 0 until first saved)' })
  @ApiOkResponse({ type: InvoiceTemplateResponse })
  async get(): Promise<InvoiceTemplateResponse> {
    return this.service.get();
  }

  @Put()
  @RequirePermission(Permission.SettingsWrite)
  @ApiOperation({ summary: 'Save the whole appearance; validated strictly (no HTML, CSS or URLs anywhere)' })
  @ApiOkResponse({ type: InvoiceTemplateResponse })
  @ApiBadRequestResponse({ description: 'error.validation.failed (details.fields: template.<field>)' })
  @ApiConflictResponse({ description: 'error.concurrency.stale' })
  async save(@Body() body: SaveInvoiceTemplateRequest, @CurrentUser() user: AuthUser): Promise<InvoiceTemplateResponse> {
    return this.service.save(body.rowVersion, body.template, user.id);
  }
}
