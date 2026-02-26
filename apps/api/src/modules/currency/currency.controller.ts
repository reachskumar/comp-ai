import {
  Controller,
  Post,
  Get,
  Put,
  Query,
  Body,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth';
import { TenantGuard } from '../../common';
import { CurrencyService } from './currency.service';
import { CreateExchangeRateDto, UpdateTenantCurrencyDto, ConvertQueryDto } from './dto';

interface AuthRequest {
  user: { userId: string; tenantId: string; email: string; role: string };
}

@ApiTags('currency')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('currency')
export class CurrencyController {
  constructor(private readonly currencyService: CurrencyService) {}

  // ─── Exchange Rates ─────────────────────────────────────────

  @Get('rates')
  @ApiOperation({ summary: 'List exchange rates for tenant' })
  async listRates(@Request() req: AuthRequest) {
    return this.currencyService.listRates(req.user.tenantId);
  }

  @Post('rates')
  @ApiOperation({ summary: 'Add or update an exchange rate (manual entry)' })
  @HttpCode(HttpStatus.OK)
  async createRate(@Body() dto: CreateExchangeRateDto, @Request() req: AuthRequest) {
    return this.currencyService.createOrUpdateRate(req.user.tenantId, dto);
  }

  @Post('rates/fetch')
  @ApiOperation({ summary: 'Fetch latest rates from external API (free tier)' })
  @HttpCode(HttpStatus.OK)
  async fetchRates(@Request() req: AuthRequest) {
    return this.currencyService.fetchLatestRates(req.user.tenantId);
  }

  // ─── Conversion ─────────────────────────────────────────────

  @Get('convert')
  @ApiOperation({ summary: 'Convert amount between currencies' })
  async convert(@Query() query: ConvertQueryDto, @Request() req: AuthRequest) {
    return this.currencyService.convert(req.user.tenantId, query);
  }

  // ─── Tenant Currency Settings ───────────────────────────────

  @Get('supported')
  @ApiOperation({ summary: 'List supported currencies for tenant' })
  async getSupportedCurrencies(@Request() req: AuthRequest) {
    return this.currencyService.getSupportedCurrencies(req.user.tenantId);
  }

  @Put('settings')
  @ApiOperation({ summary: 'Update tenant base currency and supported currencies' })
  async updateSettings(@Body() dto: UpdateTenantCurrencyDto, @Request() req: AuthRequest) {
    return this.currencyService.updateSettings(req.user.tenantId, dto);
  }
}
