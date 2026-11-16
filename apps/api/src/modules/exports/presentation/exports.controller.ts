import { Controller, Get, Headers, Param, Query, Res, StreamableFile } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ParseIdPipe } from '../../../shared/http/parse-id.pipe';
import { I18nService } from '../../../shared/i18n/i18n.service';
import type { Language } from '../../../shared/i18n/i18n.service';
import { containsPattern } from '../../../shared/text/names';
import { Permission } from '../../identity/domain/permissions';
import { AlsoRequire, CurrentUser, RequirePermission } from '../../identity/presentation/auth.decorators';
import type { AuthUser } from '../../identity/presentation/auth.decorators';
import { ExportFile, ExportsService } from '../application/exports.service';
import { DebtsExportQuery, ExportLangQuery, PaymentsExportQuery, StatementExportQuery } from './dto';

const CSV_OK = {
  description: 'UTF-8 CSV with a byte order mark (Excel opens Arabic correctly), CRLF line ends',
  content: { 'text/csv': { schema: { type: 'string', format: 'binary' } } },
};

const defined = <T extends object>(o: T): T =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

/**
 * CSV exports of the money reports (SPEC §10). Each needs the permission to read the data AND
 * `exports.run`, is audited, and honours the same filters as the screen.
 */
@ApiTags('exports')
@ApiBearerAuth()
@Controller('exports')
@ApiProduces('text/csv')
@ApiTooManyRequestsResponse({ description: 'error.rate_limited' })
@ApiUnprocessableEntityResponse({ description: 'error.export.too_large' })
export class ExportsController {
  constructor(
    private readonly service: ExportsService,
    private readonly i18n: I18nService,
  ) {}

  private lang(q: ExportLangQuery, header: string | undefined): Language {
    return q.lang ?? this.i18n.resolveLanguage(header);
  }

  private send(res: Response, file: ExportFile): StreamableFile {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Export-Rows', String(file.rows));
    return new StreamableFile(file.body);
  }

  @Get('debts')
  @RequirePermission(Permission.LedgerRead)
  @AlsoRequire(Permission.ExportsRun)
  @ApiOperation({ summary: 'Debts as CSV: one row per doctor with a balance (same filters as the screen)' })
  @ApiOkResponse(CSV_OK)
  async debts(
    @Query() q: DebtsExportQuery,
    @Headers('accept-language') acceptLanguage: string | undefined,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const search = q.search?.trim();
    const file = await this.service.debts(
      user.id,
      { direction: q.direction, ...(search ? { search, pattern: containsPattern(search) } : {}) },
      this.lang(q, acceptLanguage),
    );
    return this.send(res, file);
  }

  @Get('doctors/:id/debt-breakdown')
  @RequirePermission(Permission.LedgerRead)
  @AlsoRequire(Permission.CasesRead, Permission.ExportsRun)
  @ApiOperation({ summary: 'Debt breakdown of one doctor as CSV; the Remaining column sums to the balance' })
  @ApiOkResponse(CSV_OK)
  @ApiNotFoundResponse({ description: 'error.not_found' })
  async breakdown(
    @Param('id', ParseIdPipe) id: number,
    @Query() q: ExportLangQuery,
    @Headers('accept-language') acceptLanguage: string | undefined,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    return this.send(res, await this.service.breakdown(user.id, id, this.lang(q, acceptLanguage)));
  }

  @Get('doctors/:id/statement')
  @RequirePermission(Permission.LedgerRead)
  @AlsoRequire(Permission.ExportsRun)
  @ApiOperation({ summary: 'Account statement of one doctor as CSV, for the chosen date range' })
  @ApiOkResponse(CSV_OK)
  @ApiNotFoundResponse({ description: 'error.not_found' })
  async statement(
    @Param('id', ParseIdPipe) id: number,
    @Query() q: StatementExportQuery,
    @Headers('accept-language') acceptLanguage: string | undefined,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const file = await this.service.statement(
      user.id,
      id,
      defined({ from: q.from, to: q.to }),
      user.permissions.includes(Permission.CasesRead),
      this.lang(q, acceptLanguage),
    );
    return this.send(res, file);
  }

  @Get('payments')
  @RequirePermission(Permission.PaymentsRead)
  @AlsoRequire(Permission.ExportsRun)
  @ApiOperation({ summary: 'Payments (receipts report) as CSV with the filters of the payments list' })
  @ApiOkResponse(CSV_OK)
  async payments(
    @Query() q: PaymentsExportQuery,
    @Headers('accept-language') acceptLanguage: string | undefined,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { search, ...filter } = q;
    delete (filter as { lang?: string }).lang;
    const trimmed = search?.trim();
    const file = await this.service.payments(
      user.id,
      defined({ ...filter, ...(trimmed ? { search: trimmed } : {}) }),
      this.lang(q, acceptLanguage),
    );
    return this.send(res, file);
  }
}
