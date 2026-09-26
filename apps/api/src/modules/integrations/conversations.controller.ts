import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { PERMISSIONS } from '@klinara/shared';
import { RequirePermission } from '../../common/decorators/auth.decorators';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { Principal } from '../identity/principal';
import { ConversationsService } from './conversations.service';
import {
  ConversationDetailDto,
  ConversationDto,
  ConversationMessageDto,
  ConversationPageDto,
  ConversationTemplateOptionDto,
  LinkConversationCustomerDto,
  ListConversationsQueryDto,
  SendConversationMessageDto,
  SendConversationTemplateDto,
  UnreadConversationsDto,
} from './dto/conversation.dto';

/**
 * WhatsApp sohbetleri — resepsiyonun ekranı.
 *
 * Kapı `notification:send`, `notification:read` DEĞİL: `read` uygulayıcıda da
 * var ve sohbet ekranı müşteriyle yazışmanın kendisi. Okuyabilen ama
 * cevaplayamayan bir rolün buraya girmesinin anlamı yok; mesaj kaydını
 * (`GET /messages`) zaten görüyor.
 */
@ApiTags('integrations')
@ApiBearerAuth('bearerAuth')
@Controller('conversations')
@RequirePermission(PERMISSIONS.NOTIFICATION_SEND)
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  @Get()
  @ApiOperation({
    summary: 'Sohbet listesi',
    description: 'Son mesaja göre yeniden eskiye. Varsayılan yalnız açık sohbetler.',
  })
  @ApiOkResponse({ type: ConversationPageDto })
  list(@Query() query: ListConversationsQueryDto): Promise<ConversationPageDto> {
    return this.conversations.list(query);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Açık ve okunmamış sohbet sayısı (menü rozeti)' })
  @ApiOkResponse({ type: UnreadConversationsDto })
  async unreadCount(): Promise<UnreadConversationsDto> {
    return { count: await this.conversations.unreadCount() };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Sohbet ve son 200 mesajı' })
  @ApiOkResponse({ type: ConversationDetailDto })
  get(@Param('id', new ParseUUIDPipe()) id: string): Promise<ConversationDetailDto> {
    return this.conversations.get(id);
  }

  @Post(':id/messages')
  @ApiOperation({
    summary: 'Serbest metin cevap gönder',
    description:
      '24 saatlik pencere kapalıysa 422 `WHATSAPP_WINDOW_CLOSED`. Gönderim hatası bir HTTP hatası ' +
      'DEĞİLDİR: mesaj `status: failed` ve `errorDetail` ile döner.',
  })
  @ApiCreatedResponse({ type: ConversationMessageDto })
  send(
    @CurrentUser() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: SendConversationMessageDto,
  ): Promise<ConversationMessageDto> {
    return this.conversations.send(principal, id, body.body);
  }

  @Get(':id/templates')
  @ApiOperation({
    summary: 'Bu sohbete gönderilebilecek şablonlar',
    description:
      "Meta'da onaylı, butonsuz UTILITY şablonları; önerilen parametrelerle. " +
      'Pencere kapalıyken sohbeti yeniden başlatmanın tek yolu.',
  })
  @ApiOkResponse({ type: [ConversationTemplateOptionDto] })
  templates(@Param('id', new ParseUUIDPipe()) id: string): Promise<ConversationTemplateOptionDto[]> {
    return this.conversations.templateOptions(id);
  }

  @Post(':id/template')
  @ApiOperation({
    summary: 'Onaylı şablon gönder',
    description:
      'Pencere kontrolü YOK — şablon, pencere kapalıyken de gönderilebilir. Onaysız, butonlu ya da ' +
      'parametre sayısı tutmayan şablon 422. Gönderim hatası `status: failed` ile döner.',
  })
  @ApiCreatedResponse({ type: ConversationMessageDto })
  sendTemplate(
    @CurrentUser() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: SendConversationTemplateDto,
  ): Promise<ConversationMessageDto> {
    return this.conversations.sendTemplate(principal, id, body);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Okundu olarak işaretle' })
  @ApiNoContentResponse()
  markRead(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    return this.conversations.markRead(id);
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sohbeti kapat',
    description: 'Bekleyen gelen mesajlar işlendi sayılır. Müşteri yeniden yazarsa sohbet açılır.',
  })
  @ApiOkResponse({ type: ConversationDto })
  close(
    @CurrentUser() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ConversationDto> {
    return this.conversations.setStatus(principal, id, 'closed');
  }

  @Post(':id/reopen')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sohbeti yeniden aç' })
  @ApiOkResponse({ type: ConversationDto })
  reopen(
    @CurrentUser() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ConversationDto> {
    return this.conversations.setStatus(principal, id, 'open');
  }

  @Put(':id/customer')
  @RequirePermission(PERMISSIONS.NOTIFICATION_SEND, PERMISSIONS.CUSTOMER_READ)
  @ApiOperation({
    summary: 'Sohbeti bir müşteriye bağla',
    description: 'Kayıtlı olmayan bir numaradan gelen sohbet için. Geçmiş gelen mesajlar da bağlanır.',
  })
  @ApiOkResponse({ type: ConversationDto })
  linkCustomer(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: LinkConversationCustomerDto,
  ): Promise<ConversationDto> {
    return this.conversations.linkCustomer(id, body.customerId);
  }
}
