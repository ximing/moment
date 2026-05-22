import {
  createCommentInputSchema,
  type CommentDto,
  type CommentListResponse,
  type UserProfile,
} from '@moment/dto';
import {
  Authorized,
  Body,
  CurrentUser,
  Delete,
  Get,
  HttpCode,
  JsonController,
  OnUndefined,
  Param,
  Post,
  QueryParam,
} from 'routing-controllers';
import { Service } from 'typedi';
import { CommentService } from './comment.service.js';

/** 按 moment id 反查链：service 层 ChainPolicy（CONVENTIONS §3.1）。viewer 即可评论/读取（spec §1）。 */
@JsonController()
@Service()
export class CommentsController {
  constructor(private readonly commentService: CommentService) {}

  @Get('/moments/:id/comments')
  @Authorized()
  list(
    @Param('id') momentId: string,
    @CurrentUser() user: UserProfile,
    @QueryParam('cursor', { required: false, type: String }) cursor: string | undefined,
    @QueryParam('limit', { required: false, type: String }) limit: string | undefined
  ): Promise<CommentListResponse> {
    return this.commentService.list(user.id, momentId, { cursor, limit });
  }

  @Post('/moments/:id/comments')
  @Authorized()
  @HttpCode(201)
  create(
    @Param('id') momentId: string,
    @Body() body: unknown,
    @CurrentUser() user: UserProfile
  ): Promise<CommentDto> {
    return this.commentService.create(user.id, momentId, createCommentInputSchema.parse(body));
  }

  @Delete('/comments/:id')
  @Authorized()
  @HttpCode(204)
  @OnUndefined(204)
  remove(@Param('id') commentId: string, @CurrentUser() user: UserProfile): Promise<void> {
    return this.commentService.remove(user.id, commentId);
  }
}
