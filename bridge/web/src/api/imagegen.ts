import api from './client';

// 生图 (#150 第 c 项): the opt-in image generator behind [image_gen].
// The backend never sends a picture anywhere: it writes a file and answers its path,
// so the panel shows the path and the send command instead of a "post to QQ" button.
export interface ImageGenResult {
  name: string;
  file: string;
  url: string;
  bytes: number;
  mime: string;
  seconds: number;
  model: string;
}

export interface ImageGenState {
  status: 'ready' | 'not_configured' | 'error';
  message?: string;
  can_draw: boolean;
  provider: string;
  model: string;
  base_url: string;
  out_dir: string;
  api_key_set: boolean;
  pictures: ImageGenResult[];
}

export const getImageGen = () => api.get<ImageGenState>('/image-gen');

/** Draw one picture. Costs one API call, which is why the panel asks before calling it. */
export const drawImage = (prompt: string) => api.post<ImageGenResult>('/image-gen', { prompt });