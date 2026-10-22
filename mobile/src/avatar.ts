import { avatarDataSchema } from '@/lib/friends-protocol';

export const AVATAR_INPUT_LIMIT=10*1024*1024;
export async function prepareAvatar(file:File):Promise<string> {
  if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('请选择 JPG、PNG 或 WebP 照片。');
  if(file.size>AVATAR_INPUT_LIMIT)throw Error('照片不能超过 10 MB，请选择较小的图片。');
  if(!file.size)throw Error('这张照片是空文件，请重新选择。');
  let bitmap:ImageBitmap|undefined;
  try{
    // Decode into a small bitmap and release it after exporting. No original
    // photo, object URL, metadata or file handle is retained in the profile.
    bitmap=await createImageBitmap(file,{resizeWidth:512,imageOrientation:'from-image',resizeQuality:'high'});
    if(!bitmap.width||!bitmap.height||bitmap.height>8192)throw Error('照片比例不合适，请选择普通照片。');
    const canvas=document.createElement('canvas');canvas.width=128;canvas.height=128;
    const context=canvas.getContext('2d');if(!context)throw Error('当前设备无法处理照片，请重试。');
    const side=Math.min(bitmap.width,bitmap.height);
    context.fillStyle='#fff';context.fillRect(0,0,128,128);
    context.drawImage(bitmap,(bitmap.width-side)/2,(bitmap.height-side)/2,side,side,0,0,128,128);
    for(const quality of [.86,.72,.55,.4]){
      const value=canvas.toDataURL('image/jpeg',quality);
      if(avatarDataSchema.safeParse(value).success)return value;
    }
    throw Error('照片压缩后仍过大，请换一张图片。');
  }catch(error){throw error instanceof Error&&error.message.includes('照片')?error:Error('无法读取这张照片，请换一张 JPG 或 PNG 图片。');}
  finally{bitmap?.close();}
}
