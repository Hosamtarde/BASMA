import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Put,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiProduces,
  ApiTags,
  ApiUnsupportedMediaTypeResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { LogoService } from '../application/logo.service';
import { MAX_LOGO_BYTES } from '../domain/logo';
import { Permission } from '../../identity/domain/permissions';
import { CurrentUser, RequirePermission } from '../../identity/presentation/auth.decorators';
import type { AuthUser } from '../../identity/presentation/auth.decorators';
import { SettingsService, SettingsView } from '../application/settings.service';
import {
  LogoUploadRequest,
  SettingsResponse,
  UpdateCurrencyRequest,
  UpdateLabProfileRequest,
  UpdateLanguageRequest,
  UpdateNumberingRequest,
} from './dto';

export const toSettingsResponse = (v: SettingsView): SettingsResponse => ({
  labProfile: v.labProfile && {
    nameAr: v.labProfile.nameAr,
    nameEn: v.labProfile.nameEn,
    phone: v.labProfile.phone,
    address: v.labProfile.address,
    timeZone: v.labProfile.timeZone,
    rowVersion: v.labProfile.rowVersion,
  },
  currency: v.currency && {
    code: v.currency.code,
    symbol: v.currency.symbol,
    decimals: v.currency.decimals,
    rowVersion: v.currency.rowVersion,
    locked: v.currency.locked,
  },
  language: v.language && {
    ui: v.language.ui,
    documents: v.language.documents,
    rowVersion: v.language.rowVersion,
  },
  numbering: { caseNo: v.numbering.case_no, invoiceNo: v.numbering.invoice_no },
  logo: {
    present: v.logo !== null,
    mimeType: v.logo?.mimeType ?? null,
    sizeBytes: v.logo?.sizeBytes ?? null,
    sha256: v.logo?.sha256 ?? null,
    updatedAt: v.logo?.updatedAt.toISOString() ?? null,
  },
});

/** The part of Multer's file object we use (avoids an extra @types package). */
interface UploadedFileData {
  buffer: Buffer;
}

@ApiTags('settings')
@ApiBearerAuth()
@Controller('settings')
export class SettingsController {
  constructor(
    private readonly service: SettingsService,
    private readonly logos: LogoService,
  ) {}

  @Get('logo')
  @RequirePermission(Permission.SettingsRead)
  @ApiOperation({ summary: 'The stored lab logo (404 = use the bundled default)' })
  @ApiProduces('image/png', 'image/jpeg')
  @ApiOkResponse({ description: 'Image bytes' })
  @ApiNotFoundResponse({ description: 'error.not_found' })
  async logo(@Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const logo = await this.logos.file();
    res.setHeader('Cache-Control', 'private, no-cache');
    res.setHeader('ETag', `"${logo.sha256}"`);
    return new StreamableFile(logo.content, { type: logo.mimeType, length: logo.sizeBytes });
  }

  @Put('logo')
  @RequirePermission(Permission.SettingsWrite)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_LOGO_BYTES, files: 1, fields: 0 } }))
  @ApiOperation({ summary: 'Upload the lab logo (PNG/JPEG, ≤ 1 MB; type checked from the bytes)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: LogoUploadRequest })
  @ApiOkResponse({ type: SettingsResponse })
  @ApiBadRequestResponse({ description: 'error.logo.missing' })
  @ApiPayloadTooLargeResponse({ description: 'error.payload_too_large' })
  @ApiUnsupportedMediaTypeResponse({ description: 'error.logo.invalid_type' })
  async uploadLogo(
    @UploadedFile() file: UploadedFileData | undefined,
    @CurrentUser() user: AuthUser,
  ): Promise<SettingsResponse> {
    await this.logos.save(file?.buffer, user.id);
    return toSettingsResponse(await this.service.view());
  }

  @Delete('logo')
  @RequirePermission(Permission.SettingsWrite)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove the stored logo (back to the bundled default)' })
  @ApiNoContentResponse()
  async removeLogo(@CurrentUser() user: AuthUser): Promise<void> {
    await this.logos.remove(user.id);
  }

  @Get()
  @RequirePermission(Permission.SettingsRead)
  @ApiOperation({ summary: 'Lab profile, currency, language and numbering, with lock states' })
  @ApiOkResponse({ type: SettingsResponse })
  async get(): Promise<SettingsResponse> {
    return toSettingsResponse(await this.service.view());
  }

  @Patch('lab-profile')
  @RequirePermission(Permission.SettingsWrite)
  @ApiOkResponse({ type: SettingsResponse })
  @ApiBadRequestResponse({ description: 'error.validation.failed | error.settings.lab_name_required' })
  @ApiConflictResponse({ description: 'error.concurrency.stale' })
  async updateLabProfile(
    @Body() body: UpdateLabProfileRequest,
    @CurrentUser() user: AuthUser,
  ): Promise<SettingsResponse> {
    const { rowVersion, ...patch } = body;
    return toSettingsResponse(await this.service.updateLabProfile(rowVersion, patch, user.id));
  }

  @Patch('currency')
  @RequirePermission(Permission.SettingsWrite)
  @ApiOperation({ summary: 'Code and decimals lock once any amount exists; the symbol stays editable' })
  @ApiOkResponse({ type: SettingsResponse })
  @ApiConflictResponse({ description: 'error.settings.currency_locked | error.concurrency.stale' })
  async updateCurrency(
    @Body() body: UpdateCurrencyRequest,
    @CurrentUser() user: AuthUser,
  ): Promise<SettingsResponse> {
    const { rowVersion, ...patch } = body;
    return toSettingsResponse(await this.service.updateCurrency(rowVersion, patch, user.id));
  }

  @Patch('language')
  @RequirePermission(Permission.SettingsWrite)
  @ApiOkResponse({ type: SettingsResponse })
  @ApiConflictResponse({ description: 'error.concurrency.stale' })
  async updateLanguage(
    @Body() body: UpdateLanguageRequest,
    @CurrentUser() user: AuthUser,
  ): Promise<SettingsResponse> {
    const { rowVersion, ...patch } = body;
    return toSettingsResponse(await this.service.updateLanguage(rowVersion, patch, user.id));
  }

  @Patch('numbering')
  @RequirePermission(Permission.SettingsWrite)
  @ApiOperation({ summary: 'First case/invoice number; only until the first number is issued' })
  @ApiOkResponse({ type: SettingsResponse })
  @ApiConflictResponse({ description: 'error.settings.numbering_locked' })
  async updateNumbering(
    @Body() body: UpdateNumberingRequest,
    @CurrentUser() user: AuthUser,
  ): Promise<SettingsResponse> {
    return toSettingsResponse(
      await this.service.updateNumbering(
        { case_no: body.caseNoStart, invoice_no: body.invoiceNoStart },
        user.id,
      ),
    );
  }
}
