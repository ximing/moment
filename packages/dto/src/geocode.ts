import { z } from 'zod';

/** POST /api/geocode/reverse：登录用户预览 EXIF 坐标对应的地名，填进「在哪里」。 */
export const reverseGeocodeInputSchema = z
  .object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  })
  .strict();
export type ReverseGeocodeInput = z.infer<typeof reverseGeocodeInputSchema>;

export interface ReverseGeocodeResponse {
  /** 逆地理失败或未配置 key 时为 null，不挡选图。 */
  name: string | null;
}
