import { searchInputSchema, type SearchResponse, type UserProfile } from '@moment/dto';
import { Authorized, Body, CurrentUser, JsonController, Post } from 'routing-controllers';
import { Service } from 'typedi';
import { SearchService } from './search.service.js';

@JsonController()
@Service()
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Post('/search')
  @Authorized()
  search(@Body() body: unknown, @CurrentUser() user: UserProfile): Promise<SearchResponse> {
    const input = searchInputSchema.parse(body);
    return this.searchService.search(user.id, input);
  }
}
