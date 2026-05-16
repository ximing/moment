import type {
  MediaCompleteResponse,
  MediaPartsResponse,
  MediaPresignResponse,
  UserProfile,
} from '@moment/dto';
import {
  mediaCompleteInputSchema,
  mediaPartsInputSchema,
  mediaPresignInputSchema,
} from '@moment/dto';
import {
  Authorized,
  Body,
  CurrentUser,
  Get,
  HttpCode,
  JsonController,
  OnUndefined,
  Param,
  Post,
  QueryParam,
  Res,
} from 'routing-controllers';
import type { Response } from 'express';
import { Service } from 'typedi';
import { MediaService } from './media.service.js';

@JsonController('/media')
@Service()
export class MediaController {
  constructor(private mediaService: MediaService) {}

  @Post('/presign')
  @Authorized()
  @HttpCode(201)
  presign(@Body() body: unknown, @CurrentUser() user: UserProfile): Promise<MediaPresignResponse> {
    return this.mediaService.presign(user.id, mediaPresignInputSchema.parse(body));
  }

  @Post('/:id/parts')
  @Authorized()
  parts(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser() user: UserProfile
  ): Promise<MediaPartsResponse> {
    return this.mediaService.presignParts(user.id, id, mediaPartsInputSchema.parse(body));
  }

  @Post('/:id/complete')
  @Authorized()
  complete(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser() user: UserProfile
  ): Promise<MediaCompleteResponse> {
    return this.mediaService.complete(user.id, id, mediaCompleteInputSchema.parse(body));
  }

  @Post('/:id/abort')
  @Authorized()
  @HttpCode(204)
  @OnUndefined(204)
  abort(@Param('id') id: string, @CurrentUser() user: UserProfile): Promise<void> {
    return this.mediaService.abort(user.id, id);
  }

  @Get('/:id')
  @Authorized()
  async access(
    @Param('id') id: string,
    @QueryParam('st', { required: false, type: String }) st: string | undefined,
    @CurrentUser() user: UserProfile,
    @Res() res: Response
  ): Promise<Response> {
    const url = await this.mediaService.resolveAccessUrl(user, id, st);
    res.setHeader('Cache-Control', 'private, max-age=300');
    return res.redirect(302, url);
  }
}
