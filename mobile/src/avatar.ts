import { avatarDataSchema } from '@/lib/friends-protocol';

export const AVATAR_INPUT_LIMIT=10*1024*1024;
export type AvatarCrop = {x:number; y:number; zoom:number};
export function cropRegion(width:number,height:number,crop:AvatarCrop) {
  const zoom=Math.max(1,Math.min(4,Number.isFinite(crop.zoom)?crop.zoom:1));
  const size=Math.min(width,height)/zoom;
  const x=Math.max(size/2,Math.min(width-size/2,Number.isFinite(crop.x)?crop.x:width/2));
  const y=Math.max(size/2,Math.min(height-size/2,Number.isFinite(crop.y)?crop.y:height/2));
  return {x,y,zoom,left:x-size/2,top:y-size/2,size};
}
export async function decodeAvatar(file:File):Promise<ImageBitmap> {
  if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('请选择 JPG、PNG 或 WebP 照片。');
  if(file.size>AVATAR_INPUT_LIMIT)throw Error('照片不能超过 10 MB，请选择较小的图片。');
  if(!file.size)throw Error('这张照片是空文件，请重新选择。');
  let bitmap:ImageBitmap|undefined;
  try{
    // Keep only bounded decoded pixels while choosing the crop; no object URL.
    bitmap=await createImageBitmap(file,{resizeWidth:1024,imageOrientation:'from-image',resizeQuality:'high'});
    if(!bitmap.width||!bitmap.height||bitmap.height>8192)throw Error('照片比例不合适，请选择普通照片。');
    return bitmap;
  }catch(error){bitmap?.close();throw error instanceof Error&&error.message.includes('照片')?error:Error('无法读取这张照片，请换一张 JPG 或 PNG 图片。');}
}
export function exportAvatar(bitmap:ImageBitmap,crop:AvatarCrop):string {
    const region=cropRegion(bitmap.width,bitmap.height,crop);
    const canvas=document.createElement('canvas');canvas.width=128;canvas.height=128;
    const context=canvas.getContext('2d');if(!context)throw Error('当前设备无法处理照片，请重试。');
    context.fillStyle='#fff';context.fillRect(0,0,128,128);
    context.drawImage(bitmap,region.left,region.top,region.size,region.size,0,0,128,128);
    for(const quality of [.86,.72,.55,.4]){
      const value=canvas.toDataURL('image/jpeg',quality);
      if(avatarDataSchema.safeParse(value).success)return value;
    }
    throw Error('照片压缩后仍过大，请换一张图片。');
}
export async function prepareAvatar(file:File):Promise<string> {
  const bitmap=await decodeAvatar(file);
  try{return exportAvatar(bitmap,{x:bitmap.width/2,y:bitmap.height/2,zoom:1});}
  finally{bitmap.close();}
}
