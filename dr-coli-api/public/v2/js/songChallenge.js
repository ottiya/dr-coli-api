/* songChallenge.js (MVP)
   - songReady: shows magic board + Play button
   - songChallenge: plays song, 9 cue windows, first tap counts, micro feedback, end screen
   Usage from v2.js (pseudo):
     if (scene.interaction.type==='songReady') await SongChallenge.songReady(scene.interaction);
     if (scene.interaction.type==='songChallenge') await SongChallenge.songChallenge(scene.interaction);
*/

(function(){
  'use strict';

  const STORAGE_NAME_KEY = 'drcoli_kidname';

  function host(){
    return document.getElementById('uiLayer') || document.getElementById('viewport') || document.body;
  }

  function name(){
    const n=(localStorage.getItem(STORAGE_NAME_KEY)||'').trim();
    return n || 'Explorer';
  }

  function personalize(s){
    if (typeof window.personalizeText==='function') return window.personalizeText(s);
    return String(s||'').replaceAll('{name}', name());
  }

  function el(tag, attrs={}, kids=[]){
    const n=document.createElement(tag);
    for(const [k,v] of Object.entries(attrs)){
      if(k==='class') n.className=v;
      else if(k==='style') Object.assign(n.style,v);
      else n.setAttribute(k,v);
    }
    for(const kid of kids){
      n.appendChild(typeof kid==='string'?document.createTextNode(kid):kid);
    }
    return n;
  }

  function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

  async function unlockAudio(){
    try{
      const AC=window.AudioContext||window.webkitAudioContext;
      if(!AC) return;
      const ctx=new AC();
      await ctx.resume();
      const osc=ctx.createOscillator();
      const gain=ctx.createGain();
      gain.gain.value=0;
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(); osc.stop(ctx.currentTime+0.01);
    }catch{}
  }

  function setChars(dr, bo){
    try{
      if(typeof window.setDrColiAnimation==='function') window.setDrColiAnimation(dr);
      if(typeof window.setBoriAnimation==='function') window.setBoriAnimation(bo);
    }catch{}
  }

  function ensureFx(){
    let fx=document.querySelector('.fx-layer');
    if(!fx){ fx=el('div',{class:'fx-layer'}); host().appendChild(fx); }
    return fx;
  }

  // Uses your global confettiBurst if present; otherwise tiny fallback burst
  function confettiAt(x,y,count=10){
    if (typeof window.confettiBurst === 'function') {
      try { window.confettiBurst(x,y,count); } catch {}
    }
  }
  }

  function existingEmojiButtons(){
    const btns=Array.from(document.querySelectorAll('.emoji-slot'));
    return btns.length>=3?btns.slice(0,3):null;
  }

  function showEmojiTray(on){
    const tray=document.querySelector('.emoji-tray');
    if(tray) tray.classList.toggle('active', !!on);
  }

  function buildBoard(boardSrc){
    const overlay=el('div',{class:'song-overlay',style:{position:'absolute',inset:'0',display:'grid',placeItems:'center',zIndex:54,pointerEvents:'auto'}});
    const wrap=el('div',{style:{width:'min(900px, calc(100% - 32px))',aspectRatio:'1100/650',position:'relative',display:'grid',placeItems:'center',filter:'drop-shadow(0 18px 35px rgba(0,0,0,.35))'}});
    const img=el('img',{src:boardSrc,alt:'Magic board',style:{width:'100%',height:'100%',display:'block',borderRadius:'24px',pointerEvents:'none',userSelect:'none'}});
    const cue=el('div',{style:{position:'absolute',top:'38%',left:'50%',transform:'translate(-50%,-50%)',fontFamily:'Nunito, system-ui, sans-serif',fontWeight:'900',fontSize:'64px',color:'#2b2b2b',opacity:'0',transition:'opacity 160ms ease',whiteSpace:'nowrap',userSelect:'none'}});
    const fb=el('div',{style:{position:'absolute',top:'62%',left:'50%',transform:'translate(-50%,-50%)',fontFamily:'Nunito, system-ui, sans-serif',fontWeight:'900',fontSize:'34px',color:'#2b2b2b',opacity:'0',transition:'opacity 140ms ease',userSelect:'none'}});
    const progOuter=el('div',{style:{position:'absolute',left:'10%',right:'10%',bottom:'10%',height:'12px',borderRadius:'999px',background:'rgba(0,0,0,0.10)',overflow:'hidden'}});
    const prog=el('div',{style:{height:'100%',width:'0%',background:'rgba(77,159,80,0.85)'}});
    progOuter.appendChild(prog);
    wrap.appendChild(img); wrap.appendChild(cue); wrap.appendChild(fb); wrap.appendChild(progOuter);
    overlay.appendChild(wrap);
    host().appendChild(overlay);
    return {overlay,wrap,cue,fb,prog,destroy(){overlay.remove();}};
  }

  async function flash(node, text, ms){
    node.textContent=personalize(text);
    node.style.opacity='1';
    await sleep(ms);
    node.style.opacity='0';
  }

  async function songReady(interaction){
    const ui=buildBoard(interaction.board||'assets/ui/magic-board.png');
    ui.cue.style.opacity='1';
    ui.cue.style.fontSize='44px';
    ui.cue.textContent=personalize('Ready? Press Play!');

    const btn=el('button',{style:{position:'absolute',bottom:'18%',left:'50%',transform:'translateX(-50%)',padding:'14px 22px',borderRadius:'16px',background:'#ffd84d',color:'#2b2b2b',fontFamily:'Nunito, system-ui, sans-serif',fontWeight:'900',fontSize:'22px',cursor:'pointer',boxShadow:'0 10px 20px rgba(0,0,0,.20)'}},[interaction.playButtonText||'Play!']);
    ui.wrap.appendChild(btn);

    // show tray if you have it
    const btns=existingEmojiButtons();
    if(btns) showEmojiTray(true);

    setChars('idle','idle');

    return new Promise(resolve=>{
      btn.addEventListener('click', async ()=>{
        btn.disabled=true;
        await unlockAudio();
        ui.destroy();
        resolve({action:'play'});
      }, {once:true});
    });
  }

  async function songChallenge(interaction){
    const ui=buildBoard(interaction.board||'assets/ui/magic-board.png');

    const song=new Audio(interaction.song||'');
    song.preload='auto';

    const yay=interaction.feedback?.praiseSound ? new Audio(interaction.feedback.praiseSound) : null;
    const oops=interaction.feedback?.oopsSound ? new Audio(interaction.feedback.oopsSound) : null;
    if(yay) yay.preload='auto';
    if(oops) oops.preload='auto';

    const choices=interaction.choices||['🙇‍♀️','👋','🏃‍♀️'];
    const cues=Array.isArray(interaction.cues)?interaction.cues:[];
    const firstTapOnly = interaction.firstTapOnly !== false;

    const praiseTexts=interaction.feedback?.praiseTexts || ['Yay!','Great!','You got it!','Amazing, {name}!'];
    const lockedText=interaction.feedback?.lockedText || '✅ Locked in!';
    const streakText=interaction.feedback?.streakText || '✨ streak!';
    const streakAt=Number.isFinite(interaction.feedback?.streakAt)?interaction.feedback.streakAt:3;
    const oopsText=interaction.feedback?.oopsText || 'oops!';

    const endTiers=Array.isArray(interaction.endScreen?.tiers)?interaction.endScreen.tiers:[];
    const replayText=interaction.endScreen?.replayText||'Replay Song Challenge';
    const continueText=interaction.endScreen?.continueText||'Continue';

    // Hook to existing tray buttons
    let btns=existingEmojiButtons();
    if(btns){
      showEmojiTray(true);
      btns[0].textContent=choices[0];
      btns[1].textContent=choices[1];
      btns[2].textContent=choices[2];
    } else {
      // If you ever run without the PNG tray, you can add a fallback later
      btns=[];
    }

    let active=null, activeIndex=-1;
    let answered=false;
    let correct=0;
    let answeredCount=0;
    let streak=0;

    function isInCue(t,c){ return t>=c.start && t<=c.end; }
    function findCue(t){
      for(let i=0;i<cues.length;i++) if(isInCue(t,cues[i])) return {i,c:cues[i]};
      return null;
    }

    function applyCharForWord(word){
      if(String(word).includes('안녕하세요')) setChars('bow','bow');
      else if(String(word).includes('안녕')) setChars('wave','wave');
      else setChars('idle','idle');
    }

    function play(a){
      if(!a) return;
      try{ a.currentTime=0; a.play(); }catch{}
    }

    function randPraise(){
      return praiseTexts[Math.floor(Math.random()*praiseTexts.length)];
    }

    function setCueText(text, faded){
      ui.cue.textContent=text||'';
      ui.cue.style.opacity=text? '1':'0';
      ui.cue.style.filter=faded? 'opacity(0.65)':'none';
    }

    function progress(){
      const d=song.duration||0;
      if(!d) return;
      const p=Math.max(0,Math.min(1,song.currentTime/d));
      ui.prog.style.width=(p*100).toFixed(2)+'%';
    }

    function scoreTier(acc){
      if(!endTiers.length){
        if(acc>=0.9) return {stars:5, msg:'{name}! You\'re a SUPER STAR!'};
        if(acc>=0.7) return {stars:4, msg:'{name}! Excellent!'};
        if(acc>=0.5) return {stars:3, msg:'{name}! Good job!'};
        return {stars:2, msg:'Nice try, {name}!'};
      }
      const sorted=[...endTiers].sort((a,b)=>(b.minAccuracy||0)-(a.minAccuracy||0));
      for(const t of sorted){
        if(acc >= Number(t.minAccuracy||0)) return {stars:Number(t.stars||0), msg:t.message||''};
      }
      const last=sorted[sorted.length-1];
      return {stars:Number(last.stars||0), msg:last.message||''};
    }

    function makeEndCard(acc){
      const {stars,msg}=scoreTier(acc);
      const end=el('div',{style:{position:'absolute',inset:'0',display:'grid',placeItems:'center',zIndex:56,pointerEvents:'auto'}});
      const card=el('div',{style:{width:'min(560px, calc(100% - 32px))',background:'rgba(255,249,240,0.96)',borderRadius:'26px',padding:'22px 20px',boxShadow:'0 18px 40px rgba(0,0,0,.25)',textAlign:'center',fontFamily:'Nunito, system-ui, sans-serif',color:'#2b2b2b'}});
      card.appendChild(el('div',{style:{fontWeight:'900',fontSize:'26px',marginBottom:'8px'}},[personalize(msg)]));
      card.appendChild(el('div',{style:{fontSize:'34px',margin:'8px 0 14px',letterSpacing:'2px'}},['⭐'.repeat(Math.max(0,Math.min(5,stars)))]));
      card.appendChild(el('div',{style:{fontWeight:'800',fontSize:'15px',opacity:'0.8',marginBottom:'14px'}},[`You got ${correct} / ${cues.length}.`]));

      const replay=el('button',{style:{width:'100%',padding:'14px',borderRadius:'16px',background:'#ffd84d',color:'#2b2b2b',fontWeight:'900',fontSize:'18px',cursor:'pointer'}},[replayText]);
      const cont=el('button',{style:{width:'100%',padding:'12px',borderRadius:'16px',background:'#fff',color:'#2b2b2b',fontWeight:'900',fontSize:'16px',cursor:'pointer',border:'2px solid rgba(0,0,0,0.08)',marginTop:'10px'}},[continueText]);
      card.appendChild(replay);
      card.appendChild(cont);
      end.appendChild(card);
      ui.overlay.appendChild(end);

      // Big finale confetti
      const r=host().getBoundingClientRect();
      const cx=r.left+r.width/2, cy=r.top+r.height/2;
      for(let i=0;i<4;i++) setTimeout(()=>confettiAt(cx,cy,36), i*220);

      return new Promise(res=>{
        replay.addEventListener('click',()=>res({action:'replay'}),{once:true});
        cont.addEventListener('click',()=>res({action:'continue'}),{once:true});
      });
    }

    // Emoji tap handler
    function onTap(idx, btn){
      if(!active) return;
      if(firstTapOnly && answered) return;
      answered=true;
      answeredCount++;

      const ok = idx === Number(active.correctIndex);
      setCueText(active.word, true);

      const rect=btn.getBoundingClientRect();
      confettiAt(rect.left+rect.width/2, rect.top+rect.height/2, 10);

      if(ok){
        correct++; streak++;
        if(Math.random()<0.55) play(yay);
        if(Math.random()<0.7) flash(ui.fb, randPraise(), 520);
        if(streakAt>0 && streak===streakAt) flash(ui.fb, streakText, 520);
      } else {
        streak=0;
        play(oops);
        flash(ui.fb, oopsText, 420);
      }
      flash(ui.fb, lockedText, 520);
    }

    const bound=[];
    btns.forEach((b,i)=>{
      const h=()=>onTap(i,b);
      bound.push([b,h]);
      b.addEventListener('click', h);
    });

    // Start song (with fallback tap prompt)
    await unlockAudio();
    try{
      song.currentTime=0;
      await song.play();
    }catch{
      ui.cue.style.opacity='1';
      ui.cue.style.fontSize='28px';
      ui.cue.textContent='Tap to start the song 🔊';
      ui.overlay.addEventListener('click', async ()=>{
        try{ await unlockAudio(); ui.cue.style.opacity='0'; await song.play(); }catch{}
      });
    }

    let raf=0;
    function tick(){
      progress();
      const t=song.currentTime||0;
      const f=findCue(t);
      if(f){
        if(f.i!==activeIndex){
          activeIndex=f.i; active=f.c; answered=false;
          setCueText(active.word,false);
          ui.fb.style.opacity='0';
          applyCharForWord(active.word);
        }
      } else {
        activeIndex=-1; active=null; answered=false;
        setCueText('',false);
        setChars('idle','idle');
      }
      raf=requestAnimationFrame(tick);
    }
    raf=requestAnimationFrame(tick);

    // Wait end (ended OR last cue + buffer)
    const lastEnd=cues.length?Math.max(...cues.map(c=>c.end||0)):0;
    await new Promise(resolve=>{
      let done=false;
      const finish=()=>{ if(done) return; done=true; try{song.pause();}catch{} resolve(); };
      song.addEventListener('ended', finish, {once:true});
      setTimeout(finish, (lastEnd+2.0)*1000);
    });

    cancelAnimationFrame(raf);

    const acc=cues.length? (correct/cues.length):0;
    const endResult=await makeEndCard(acc);

    // cleanup
    bound.forEach(([b,h])=>b.removeEventListener('click',h));
    ui.destroy();

    return endResult;
  }

  window.SongChallenge = { songReady, songChallenge };
})();
