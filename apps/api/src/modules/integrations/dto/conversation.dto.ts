import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export const CONVERSATION_STATUS_FILTERS = ['open', 'closed', 'all'] as const;
export type ConversationStatusFilter = (typeof CONVERSATION_STATUS_FILTERS)[number];

export class ListConversationsQueryDto {
  @ApiPropertyOptional({ enum: CONVERSATION_STATUS_FILTERS, default: 'open' })
  @IsOptional()
  @IsIn(CONVERSATION_STATUS_FILTERS)
  status?: ConversationStatusFilter;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  unreadOnly?: boolean;

  @ApiPropertyOptional({ default: 50, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ description: 'Önceki yanıtın pageInfo.nextCursor değeri' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;
}

export class ConversationCustomerDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  fullName: string;
}

export class ConversationDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: '+905321234567', description: 'E.164 — kayıtlı olmayan numara da olabilir' })
  phone: string;

  @ApiPropertyOptional({ type: ConversationCustomerDto, nullable: true })
  customer: ConversationCustomerDto | null;

  @ApiProperty({ enum: ['open', 'closed'] })
  status: 'open' | 'closed';

  @ApiProperty({ format: 'date-time' })
  lastMessageAt: string;

  @ApiPropertyOptional({ nullable: true })
  lastMessagePreview: string | null;

  @ApiPropertyOptional({ enum: ['in', 'out'], nullable: true })
  lastMessageDirection: 'in' | 'out' | null;

  @ApiProperty({ description: 'Müşterinin son mesajı okunmamış mı' })
  unread: boolean;

  @ApiProperty({ description: '24 saatlik pencere açık mı — kapalıyken serbest metin gönderilemez' })
  windowOpen: boolean;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  windowExpiresAt: string | null;
}

export class ConversationPageInfoDto {
  @ApiProperty()
  hasMore: boolean;

  @ApiPropertyOptional({ nullable: true })
  nextCursor: string | null;
}

export class ConversationPageDto {
  @ApiProperty({ type: [ConversationDto] })
  data: ConversationDto[];

  @ApiProperty({ type: ConversationPageInfoDto })
  pageInfo: ConversationPageInfoDto;
}

export class ConversationMessageDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: ['in', 'out'] })
  direction: 'in' | 'out';

  @ApiProperty({
    example: 'text',
    description: "Gelen: Meta'nın mesaj tipi (`text`, `button`, `image`…). Giden: `text` ya da `template`.",
  })
  type: string;

  @ApiPropertyOptional({ nullable: true })
  body: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Yalnız giden: queued, sending, sent, delivered, read, failed, skipped',
  })
  status: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Yalnız giden: bildirim olayı' })
  event: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Elle yazılmış cevabın yazarı' })
  sentByName: string | null;

  @ApiPropertyOptional({ nullable: true })
  errorDetail: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  appointmentId: string | null;
}

export class ConversationDetailDto {
  @ApiProperty({ type: ConversationDto })
  conversation: ConversationDto;

  @ApiProperty({ type: [ConversationMessageDto], description: 'Son 200 mesaj, eskiden yeniye' })
  messages: ConversationMessageDto[];
}

export class SendConversationMessageDto {
  @ApiProperty({ maxLength: 4096 })
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  body: string;
}

export class LinkConversationCustomerDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  customerId: string;
}

export class ConversationTemplateOptionDto {
  @ApiProperty()
  name: string;

  @ApiProperty()
  language: string;

  @ApiProperty({ enum: ['UTILITY'] })
  category: 'UTILITY';

  @ApiProperty({ description: '`{{1}}` yer tutucularıyla gövde' })
  bodyText: string;

  @ApiProperty()
  bodyVariableCount: number;

  @ApiProperty({ type: [String], nullable: true, description: 'Değişken adları; bilinmiyorsa null' })
  variableNames: (string | null)[];

  @ApiProperty({ type: [String], description: 'Önerilen değerler; öneri yoksa boş metin' })
  suggestedParameters: string[];
}

export class SendConversationTemplateDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  templateName: string;

  @ApiProperty({ example: 'tr' })
  @IsString()
  @MinLength(2)
  @MaxLength(15)
  language: string;

  @ApiProperty({ type: [String], maxItems: 10 })
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(1000, { each: true })
  parameters: string[];
}

export class UnreadConversationsDto {
  @ApiProperty()
  count: number;
}
