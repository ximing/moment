import { reverseGeocodeInputSchema, type ReverseGeocodeResponse } from '@moment/dto';
import { Authorized, Body, JsonController, Post } from 'routing-controllers';
import { Service } from 'typedi';
import { getGeocodeProvider } from './factory.js';

@JsonController()
@Service()
export class GeocodeController {
  @Post('/geocode/reverse')
  @Authorized()
  async reverse(@Body() body: unknown): Promise<ReverseGeocodeResponse> {
    const input = reverseGeocodeInputSchema.parse(body);
    const provider = getGeocodeProvider();
    if (!provider) return { name: null };
    try {
      const name = await provider.reverse(input.lat, input.lng);
      if (!name) return { name: null };
      return { name: name.length > 255 ? name.slice(0, 255) : name };
    } catch {
      return { name: null };
    }
  }
}
