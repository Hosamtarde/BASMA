import { Body, Controller, Get, Patch } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Permission } from '../../identity/domain/permissions';
import { CurrentUser, RequirePermission } from '../../identity/presentation/auth.decorators';
import type { AuthUser } from '../../identity/presentation/auth.decorators';
import { SettingsService, SettingsView } from '../application/settings.service';
import {
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
});

@ApiTags('settings')
@ApiBearerAuth()
@Controller('settings')
export class SettingsController {
  constructor(private readonly service: SettingsService) {}

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
