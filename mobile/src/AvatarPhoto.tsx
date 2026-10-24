import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ImagePlus, RotateCcw } from 'lucide-react';
import { cropRegion, decodeAvatar, exportAvatar, type AvatarCrop } from './avatar';
import { Modal } from './Study';
import './AvatarPhoto.css';

/** One sheet keeps its rounded shell while moving between viewing and cropping. */
export function AvatarPhoto({preview, initialFile, draft, onApply, onClose}: {
  preview:ReactNode; initialFile?:File; draft:boolean;
  onApply:(photo:string)=>Promise<void>; onClose:()=>void;
}) {
  const [bitmap,setBitmap]=useState<ImageBitmap|null>(null);
  const pixels=useRef<ImageBitmap|null>(null);
  const [crop,setCrop]=useState<AvatarCrop>({x:0,y:0,zoom:1});
  const current=useRef(crop);
  const [loading,setLoading]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState('');
  const pending=useRef(false),sequence=useRef(0),mounted=useRef(false);
  const input=useRef<HTMLInputElement>(null),canvas=useRef<HTMLCanvasElement>(null);
  const redraw=useRef<(()=>void)|null>(null);
  const pointers=useRef(new Map<number,{x:number;y:number}>());
  function update(value:AvatarCrop) {
    if(!pixels.current)return;
    const bounded=cropRegion(pixels.current.width,pixels.current.height,value);
    current.current={x:bounded.x,y:bounded.y,zoom:bounded.zoom};setCrop(current.current);
  }
  function discard(){pixels.current?.close();pixels.current=null;setBitmap(null);pointers.current.clear();}
  async function choose(file?:File) {
    if(!file||pending.current)return;
    const ticket=++sequence.current;setLoading(true);setError('');
    try {
      const next=await decodeAvatar(file);
      if(!mounted.current||ticket!==sequence.current){next.close();return;}
      pixels.current?.close();pixels.current=next;setBitmap(next);pointers.current.clear();
      update({x:next.width/2,y:next.height/2,zoom:1});
    }catch(cause){if(mounted.current&&ticket===sequence.current)setError(cause instanceof Error?cause.message:'照片未能读取，请重试。');}
    finally{if(mounted.current&&ticket===sequence.current)setLoading(false);}
  }
  useEffect(()=>{
    mounted.current=true;
    if(initialFile)void choose(initialFile);
    return()=>{mounted.current=false;sequence.current++;pixels.current?.close();pixels.current=null;pointers.current.clear();};
  },[initialFile]);
  useLayoutEffect(()=>{
    const node=canvas.current;if(!node||!bitmap)return;
    const draw=()=>{
      if(pixels.current!==bitmap)return;
      const width=node.clientWidth;if(!width)return;
      const ratio=Math.min(window.devicePixelRatio||1,2);node.width=Math.round(width*ratio);node.height=node.width;
      const context=node.getContext('2d');if(!context)return;
      const region=cropRegion(bitmap.width,bitmap.height,current.current),scale=node.width*.8/region.size;
      context.fillStyle='#fff';context.fillRect(0,0,node.width,node.height);
      context.drawImage(bitmap,node.width/2-region.x*scale,node.height/2-region.y*scale,bitmap.width*scale,bitmap.height*scale);
    };
    redraw.current=draw;draw();const observer=new ResizeObserver(draw);observer.observe(node);return()=>{observer.disconnect();redraw.current=null;};
  },[bitmap]);
  useLayoutEffect(()=>{redraw.current?.();},[crop]);
  function gesture(){
    const points=[...pointers.current.values()].slice(0,2);
    if(!points.length)return null;
    if(points.length===1)return {...points[0],distance:0};
    return {x:(points[0].x+points[1].x)/2,y:(points[0].y+points[1].y)/2,distance:Math.hypot(points[0].x-points[1].x,points[0].y-points[1].y)};
  }
  async function confirm(){
    if(!bitmap||pending.current||loading)return;
    pending.current=true;setSaving(true);setError('');
    try{const photo=exportAvatar(bitmap,current.current);await onApply(photo);if(mounted.current)discard();}
    catch(cause){if(mounted.current)setError(cause instanceof Error?cause.message:'头像未保存，请重试。');}
    finally{pending.current=false;if(mounted.current)setSaving(false);}
  }
  return <Modal title={bitmap?'裁剪头像':'查看头像'} onClose={()=>{if(!pending.current)onClose();}}>
    <div className="avatar-photo">
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" aria-label="选择新的头像照片" hidden onChange={event=>{const file=event.target.files?.[0];event.target.value='';void choose(file);}}/>
      {bitmap?<>
        <p id="avatar-crop-help" className="avatar-photo-note">拖动照片选择区域，双指缩放。方框内就是保存后的头像。</p>
        <div className="avatar-crop-stage" role="group" tabIndex={0} aria-label="头像裁剪区域" aria-describedby="avatar-crop-help"
          onKeyDown={event=>{if(saving||loading||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();const step=cropRegion(bitmap.width,bitmap.height,current.current).size/(event.shiftKey?10:40);update({...current.current,x:current.current.x+(event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0),y:current.current.y+(event.key==='ArrowUp'?-step:event.key==='ArrowDown'?step:0)});}}
          onPointerDown={event=>{if(saving||loading||event.button>0)return;event.preventDefault();event.currentTarget.focus({preventScroll:true});event.currentTarget.setPointerCapture(event.pointerId);pointers.current.set(event.pointerId,{x:event.clientX,y:event.clientY});}}
          onPointerMove={event=>{
            if(saving||loading||!pointers.current.has(event.pointerId))return;
            const before=gesture()!;pointers.current.set(event.pointerId,{x:event.clientX,y:event.clientY});const after=gesture()!;
            const box=event.currentTarget.getBoundingClientRect(),frame=box.width*.8,old=cropRegion(bitmap.width,bitmap.height,current.current);
            const zoom=before.distance>0&&after.distance>0?Math.max(1,Math.min(4,old.zoom*after.distance/before.distance)):old.zoom;
            const size=Math.min(bitmap.width,bitmap.height)/zoom;
            update({zoom,x:old.x+(before.x-box.left-box.width/2)/frame*old.size-(after.x-box.left-box.width/2)/frame*size,y:old.y+(before.y-box.top-box.height/2)/frame*old.size-(after.y-box.top-box.height/2)/frame*size});
          }}
          onPointerUp={event=>pointers.current.delete(event.pointerId)} onPointerCancel={event=>pointers.current.delete(event.pointerId)} onLostPointerCapture={event=>pointers.current.delete(event.pointerId)}>
          <canvas ref={canvas} aria-hidden="true"/><div className="avatar-crop-frame" aria-hidden="true"><i/><i/></div>
        </div>
        <label className="avatar-zoom">缩放<span>{crop.zoom.toFixed(1)}×</span><input aria-label="头像缩放" type="range" min="1" max="4" step="0.01" value={crop.zoom} disabled={saving||loading} onChange={event=>update({...current.current,zoom:Number(event.target.value)})}/></label>
        <div className="avatar-crop-tools"><button type="button" className="ww-button ww-ghost" disabled={saving||loading} onClick={()=>update({x:bitmap.width/2,y:bitmap.height/2,zoom:1})}><RotateCcw size={16}/>重置取景</button><button type="button" className="ww-button ww-ghost" disabled={saving||loading} onClick={()=>input.current?.click()}>重新选照片</button></div>
      </>:<><div className="avatar-large-preview">{preview}</div><p className="avatar-photo-note">{draft?'正在查看资料草稿中的头像。':'当前个人头像。更换后先保存在此设备。'}</p></>}
      {loading&&<p role="status" className="avatar-photo-note">正在读取照片…</p>}
      {error&&<p className="ww-error" role="alert">{error}</p>}
      <div className="avatar-photo-actions">{bitmap?<><button type="button" className="ww-button ww-ghost" disabled={saving} onClick={()=>{sequence.current++;setLoading(false);discard();setError('');}}>取消裁剪</button><button type="button" className="ww-button ww-primary" disabled={saving||loading} onClick={()=>void confirm()}>{saving?'正在保存…':draft?'使用此区域':'保存头像'}</button></>:<button type="button" className="ww-button ww-primary" disabled={loading||saving} onClick={()=>input.current?.click()}><ImagePlus size={18}/>更换头像</button>}</div>
    </div>
  </Modal>;
}
