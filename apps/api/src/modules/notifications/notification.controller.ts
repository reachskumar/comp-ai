import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth';
import { TenantGuard } from '../../common';
import { NotificationService } from './notification.service';
import { NotificationQueryDto } from './dto';

interface AuthRequest {
  user: { userId: string; tenantId: string; email: string; role: string };
}

@ApiTags('notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get()
  @ApiOperation({ summary: 'List notifications for current user (paginated)' })
  async list(@Query() query: NotificationQueryDto, @Request() req: AuthRequest) {
    return this.notificationService.list(req.user.userId, req.user.tenantId, query);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Get unread notification count' })
  async unreadCount(@Request() req: AuthRequest) {
    return this.notificationService.unreadCount(req.user.userId, req.user.tenantId);
  }

  @Post(':id/read')
  @ApiOperation({ summary: 'Mark a notification as read' })
  @HttpCode(HttpStatus.OK)
  async markAsRead(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.notificationService.markAsRead(req.user.userId, req.user.tenantId, id);
  }

  @Post('read-all')
  @ApiOperation({ summary: 'Mark all notifications as read' })
  @HttpCode(HttpStatus.OK)
  async markAllAsRead(@Request() req: AuthRequest) {
    return this.notificationService.markAllAsRead(req.user.userId, req.user.tenantId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Dismiss (delete) a notification' })
  @HttpCode(HttpStatus.OK)
  async dismiss(@Param('id') id: string, @Request() req: AuthRequest) {
    return this.notificationService.dismiss(req.user.userId, req.user.tenantId, id);
  }
}
