import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import { SetupService } from '../application/setup.service';
import { Public } from './auth.decorators';
import { SetupRequest, SetupResponse, SetupStatusResponse } from './dto';

@ApiTags('setup')
@Public()
@Controller('setup')
export class SetupController {
  constructor(private readonly setup: SetupService) {}

  @Get('status')
  @ApiOperation({ summary: 'Is first-run setup still required?' })
  @ApiOkResponse({ type: SetupStatusResponse })
  async status(): Promise<SetupStatusResponse> {
    return { setupRequired: await this.setup.isSetupRequired() };
  }

  @Post()
  @UseGuards(ThrottlerGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'First run (works only once): owner, lab profile, currency, language, time zone',
  })
  @ApiCreatedResponse({ type: SetupResponse })
  @ApiBadRequestResponse({ description: 'error.validation.failed | error.settings.lab_name_required' })
  @ApiConflictResponse({ description: 'error.setup.already_done' })
  @ApiTooManyRequestsResponse({ description: 'error.rate_limited' })
  createOwner(@Body() body: SetupRequest): Promise<SetupResponse> {
    return this.setup.run({
      username: body.username,
      password: body.password,
      lab: body.lab,
      currency: { code: body.currency.code, symbol: body.currency.symbol, decimals: body.currency.decimals },
      language: body.language,
      ...(body.timeZone === undefined ? {} : { timeZone: body.timeZone }),
    });
  }
}
