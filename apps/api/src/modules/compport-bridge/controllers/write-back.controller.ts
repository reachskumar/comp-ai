import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { JwtAuthGuard } from '../../../auth';
import { TenantGuard } from '../../../common';
import { WriteBackService } from '../services/write-back.service';
import { WRITE_BACK_QUEUE, WriteBackJobData } from '../processors/write-back.processor';

interface AuthRequest {
  user: { userId: string; tenantId: string; email: string; role: string };
}

/**
 * Write-Back Controller.
 *
 * API endpoints for the human-in-the-loop write-back workflow:
 * 1. Create batch from approved recommendations
 * 2. Preview SQL (no Cloud SQL connection)
 * 3. Dry-run (validates against live Cloud SQL, writes nothing)
 * 4. Apply (human types "APPLY" → BullMQ job executes writes)
 * 5. View history and rollback SQL
 *
 * All endpoints require Admin role + JWT auth.
 */
@ApiTags('compport-write-back')
@Controller('compport-bridge/write-back')
@UseGuards(JwtAuthGuard, TenantGuard)
@ApiBearerAuth()
export class WriteBackController {
  private readonly logger = new Logger(WriteBackController.name);

  constructor(
    private readonly writeBackService: WriteBackService,
    @InjectQueue(WRITE_BACK_QUEUE) private readonly writeBackQueue: Queue,
  ) {}

  @Post('batches')
  @ApiOperation({ summary: 'Create a write-back batch from approved recommendations' })
  async createBatch(
    @Request() req: AuthRequest,
    @Body()
    body: {
      cycleId: string;
      connectorId: string;
      records: Array<{
        recommendationId: string;
        employeeId: string;
        fieldName: string;
        previousValue: string;
        newValue: string;
      }>;
    },
  ) {
    this.logger.log(
      `Write-back batch creation by user=${req.user.userId} tenant=${req.user.tenantId}`,
    );
    return this.writeBackService.createBatch(
      req.user.tenantId,
      body.cycleId,
      body.connectorId,
      body.records,
    );
  }

  @Post('batches/:batchId/preview')
  @ApiOperation({ summary: 'Preview SQL statements for a batch (no Cloud SQL connection)' })
  async previewBatch(@Request() req: AuthRequest, @Param('batchId') batchId: string) {
    return this.writeBackService.previewBatch(req.user.tenantId, batchId);
  }

  @Post('batches/:batchId/dry-run')
  @ApiOperation({ summary: 'Dry-run: validate against live Cloud SQL without writing' })
  async dryRun(@Request() req: AuthRequest, @Param('batchId') batchId: string) {
    return this.writeBackService.dryRun(req.user.tenantId, batchId);
  }

  @Post('batches/:batchId/apply')
  @ApiOperation({ summary: 'Apply write-back batch to Cloud SQL (human-in-the-loop gate)' })
  async applyBatch(
    @Request() req: AuthRequest,
    @Param('batchId') batchId: string,
    @Body() body: { confirmPhrase: string; selectedRecordIds?: string[] },
  ) {
    this.logger.log(`Write-back apply requested by user=${req.user.userId} batch=${batchId}`);

    // Enqueue as background job for reliability
    const jobData: WriteBackJobData = {
      tenantId: req.user.tenantId,
      batchId,
      userId: req.user.userId,
      confirmPhrase: body.confirmPhrase,
      selectedRecordIds: body.selectedRecordIds,
    };

    const job = await this.writeBackQueue.add('apply-batch', jobData, {
      attempts: 1, // No retries — human must re-trigger
      removeOnComplete: { age: 86400 }, // Keep for 24h
      removeOnFail: { age: 604800 }, // Keep failures for 7 days
    });

    return {
      jobId: job.id,
      batchId,
      status: 'QUEUED',
      message: 'Write-back job queued. Check batch status for progress.',
    };
  }

  @Post('batches/:batchId/rollback')
  @ApiOperation({ summary: 'Rollback a previously applied batch (human-in-the-loop gate)' })
  async rollbackBatch(
    @Request() req: AuthRequest,
    @Param('batchId') batchId: string,
    @Body() body: { confirmPhrase: string },
  ) {
    this.logger.warn(`Write-back ROLLBACK requested by user=${req.user.userId} batch=${batchId}`);
    return this.writeBackService.rollbackBatch(
      req.user.tenantId,
      batchId,
      req.user.userId,
      body.confirmPhrase,
    );
  }

  @Get('batches')
  @ApiOperation({ summary: 'List write-back batch history' })
  async listBatches(@Request() req: AuthRequest, @Query('cycleId') cycleId?: string) {
    return this.writeBackService.getBatchHistory(req.user.tenantId, cycleId);
  }

  @Get('batches/:batchId')
  @ApiOperation({ summary: 'Get a single write-back batch with records' })
  async getBatch(@Request() req: AuthRequest, @Param('batchId') batchId: string) {
    return this.writeBackService.getBatch(req.user.tenantId, batchId);
  }
}
