import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareAvatar, cropRegion, exportAvatar, decodeAvatar, AVATAR_INPUT_LIMIT } from '../src/avatar';
import { profileSchema, readStoredProfile } from '../src/profile';
import { sharedProfileSchema } from '@/lib/friends-protocol';

const photo='data:image/jpeg;base64,/9j/AAAA';
afterEach(()=>vi.unstubAllGlobals());
describe('bounded custom avatar',()=>{
  it('bounds movable square crops in portrait and landscape images without blank edges',()=>{
    for(const [width,height] of [[1024,512],[256,1024]])for(const zoom of [-1,1,2,4,100])for(const [x,y] of [[-1000,-1000],[10000,10000],[width/2,height/2]]){
      const region=cropRegion(width,height,{x,y,zoom});
      expect(region.left).toBeGreaterThanOrEqual(0);expect(region.top).toBeGreaterThanOrEqual(0);
      expect(region.left+region.size).toBeLessThanOrEqual(width);expect(region.top+region.size).toBeLessThanOrEqual(height);
      expect(region.zoom).toBeGreaterThanOrEqual(1);expect(region.zoom).toBeLessThanOrEqual(4);
    }
  });
  it('exports the chosen off-center region rather than reverting to a center crop',()=>{
    const drawImage=vi.fn(),close=vi.fn();
    vi.stubGlobal('document',{createElement:()=>({getContext:()=>({drawImage,fillRect:vi.fn()}),toDataURL:()=>photo})});
    const bitmap={width:1024,height:512,close} as unknown as ImageBitmap;
    exportAvatar(bitmap,{x:800,y:256,zoom:2});
    expect(drawImage).toHaveBeenCalledWith(bitmap,672,128,256,256,0,0,128,128);
    expect(close).not.toHaveBeenCalled(); // The live crop still owns the pixels for retry.
  });
  it('closes unsupported decoded dimensions before rejecting',async()=>{
    const close=vi.fn();vi.stubGlobal('createImageBitmap',vi.fn(async()=>({width:1024,height:10000,close})));
    await expect(decodeAvatar(new File(['image'],'portrait.png',{type:'image/png'}))).rejects.toThrow('比例');
    expect(close).toHaveBeenCalledOnce();
  });
  it('rejects unsupported, empty and oversized files before decoding',async()=>{
    const decode=vi.fn();vi.stubGlobal('createImageBitmap',decode);
    await expect(prepareAvatar(new File(['<svg/>'],'avatar.svg',{type:'image/svg+xml'}))).rejects.toThrow('JPG');
    await expect(prepareAvatar(new File([],'avatar.jpg',{type:'image/jpeg'}))).rejects.toThrow('空文件');
    await expect(prepareAvatar(new File([new Uint8Array(AVATAR_INPUT_LIMIT+1)],'avatar.jpg',{type:'image/jpeg'}))).rejects.toThrow('10 MB');
    expect(decode).not.toHaveBeenCalled();
  });
  it('crops the center to 128 pixels and releases decoded pixels',async()=>{
    const close=vi.fn(),drawImage=vi.fn(),fillRect=vi.fn(),exportJpeg=vi.fn(()=>photo);
    const bitmap={width:512,height:256,close};
    const canvas={width:0,height:0,getContext:()=>({drawImage,fillRect,fillStyle:''}),toDataURL:exportJpeg};
    vi.stubGlobal('createImageBitmap',vi.fn(async()=>bitmap));vi.stubGlobal('document',{createElement:()=>canvas});
    expect(await prepareAvatar(new File(['image'],'photo.png',{type:'image/png'}))).toBe(photo);
    expect(drawImage).toHaveBeenCalledWith(bitmap,128,0,256,256,0,0,128,128);
    expect(canvas.width).toBe(128);expect(canvas.height).toBe(128);expect(close).toHaveBeenCalledOnce();
  });
  it('releases decoded pixels when compression fails',async()=>{
    const close=vi.fn();vi.stubGlobal('createImageBitmap',vi.fn(async()=>({width:512,height:512,close})));
    vi.stubGlobal('document',{createElement:()=>({getContext:()=>({drawImage:vi.fn(),fillRect:vi.fn()}),toDataURL:()=>photo+'A'.repeat(17000)})});
    await expect(prepareAvatar(new File(['image'],'photo.jpg',{type:'image/jpeg'}))).rejects.toThrow('压缩');expect(close).toHaveBeenCalledOnce();
  });
  it('validates local and published photos and rejects arbitrary URLs and large data',()=>{
    const value={nickname:'读者',signature:'',avatar:'custom',avatarDataUrl:photo};
    expect(profileSchema.parse(value)).toEqual(value);
    expect(sharedProfileSchema.parse({...value,shareLearning:false}).avatarDataUrl).toBe(photo);
    expect(readStoredProfile({...value,userId:'owner'},'owner')?.avatarDataUrl).toBe(photo);
    for(const avatarDataUrl of [undefined,'https://example.com/photo.jpg','data:image/svg+xml;base64,PHN2Zz4=',photo+'A'.repeat(17000)]){
      expect(profileSchema.safeParse({...value,avatarDataUrl}).success).toBe(false);
      expect(sharedProfileSchema.safeParse({...value,avatarDataUrl,shareLearning:false}).success).toBe(false);
    }
  });
});
