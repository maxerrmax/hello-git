/* warehouse3d.js — Model 3D complet extret d'apporiol.py
 *
 * API pública (consumida per app.py):
 *   render3D(r)          — renderitza el model 3D al container #vz
 *   destroy3D()          — allibera tots els recursos WebGL
 *   set3DCamera(mode)    — 'iso' | 'top' | 'hero'
 *
 * Depèn de globals del context de app.py:
 *   S.showGaps, S.showCeiling   — toggles de la sidebar
 *   G3D                          — objecte d'estat 3D compartit
 *
 * Requereix Three.js r128 i OrbitControls carregats prèviament.
 */

// ── Estat 3D compartit ────────────────────────────────────────────────────────
// Inicialitzem G3D aquí si no existeix encara (app.py el pot declarar primer)
if (typeof G3D === 'undefined') {
  var G3D = {};
}

(function () {
  // Reset complet de l'estat intern
  function resetG3D() {
    G3D.camera         = null;
    G3D.controls       = null;
    G3D.renderer       = null;
    G3D.scene          = null;
    G3D.maxDim         = 1;
    G3D.animationId    = null;
    G3D.resizeObserver = null;
    G3D.autoTourAngle  = G3D.autoTourAngle  || 0;
    G3D.autoTourEnabled= true;
    G3D.rackGroups     = [];
    G3D.fillItems2D    = G3D.fillItems2D    || [];
    G3D.fillTimer      = G3D.fillTimer      || null;
    G3D.fillIndex      = G3D.fillIndex      || 0;
    G3D.fillPaused     = G3D.fillPaused     || false;
    G3D.fillView       = G3D.fillView       || null;
  }

  // ── destroy3D / dispose3D ─────────────────────────────────────────────────
  function destroy3D() {
    if (G3D.fillTimer) {
      clearInterval(G3D.fillTimer);
      G3D.fillTimer = null;
    }

    if (G3D.animationId) {
      cancelAnimationFrame(G3D.animationId);
      G3D.animationId = null;
    }

    if (G3D.resizeObserver) {
      G3D.resizeObserver.disconnect();
      G3D.resizeObserver = null;
    }

    if (G3D.controls && typeof G3D.controls.dispose === 'function') {
      G3D.controls.dispose();
    }

    if (G3D.scene) {
      G3D.scene.traverse(obj => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose && m.dispose());
          else obj.material.dispose && obj.material.dispose();
        }
      });
    }

    if (G3D.renderer) {
      G3D.renderer.dispose();
      if (G3D.renderer.domElement && G3D.renderer.domElement.parentNode) {
        G3D.renderer.domElement.parentNode.removeChild(G3D.renderer.domElement);
      }
    }

    // Buidar el container
    const container = document.getElementById('vz');
    if (container) container.innerHTML = '';

    G3D.camera         = null;
    G3D.controls       = null;
    G3D.renderer       = null;
    G3D.scene          = null;
    G3D.rackGroups     = [];
    G3D.fillIndex      = 0;
    G3D.fillPaused     = false;
    G3D.fillView       = null;
  }

  // ── set3DCamera ───────────────────────────────────────────────────────────
  function set3DCamera(mode) {
    if (!G3D.camera || !G3D.controls) {
      // Si no estem en 3D, canviem i tornem a cridar
      if (typeof S !== 'undefined' && S.viewMode !== '3d') {
        S.viewMode = '3d';
        if (typeof render === 'function') {
          render();
          setTimeout(() => set3DCamera(mode), 100);
        }
      }
      return;
    }

    const m = G3D.maxDim || 10;

    if (mode === 'top') {
      G3D.camera.position.set(0, m * 1.75, 0.001);
      G3D.controls.target.set(0, 0, 0);
    } else if (mode === 'hero') {
      G3D.camera.position.set(m * 0.95, m * 0.55, m * 1.10);
      G3D.controls.target.set(0, 0.28, 0);
    } else {
      // 'iso' per defecte
      G3D.camera.position.set(m * 0.85, m * 0.70, m * 1.05);
      G3D.controls.target.set(0, 0.25, 0);
    }

    G3D.camera.lookAt(G3D.controls.target);
    G3D.controls.update();
  }

  // ── render3D ─────────────────────────────────────────────────────────────
  // Signatura compatible amb app.py: render3D(r)
  // El container és sempre #vz (igual que el warehouse3d.js original)
  function render3D(r) {
    const container = document.getElementById('vz');
    if (!container || !r) return;

    destroy3D();

    if (!window.THREE) {
      container.innerHTML = '<div style="padding:32px;color:#ff6b35">Three.js could not be loaded. Check CDN/internet access.</div>';
      return;
    }

    container.innerHTML = '';

    // ── Llegir S (globals de app.py) amb fallbacks segurs ────────────────
    const showGaps    = (typeof S !== 'undefined') ? S.showGaps    : true;
    const showCeiling = (typeof S !== 'undefined') ? S.showCeiling : true;

    // ── Bounding box del warehouse ────────────────────────────────────────
    const wh = r.warehouse || [];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;

    wh.forEach(v => {
      x0 = Math.min(x0, v.x); y0 = Math.min(y0, v.y);
      x1 = Math.max(x1, v.x); y1 = Math.max(y1, v.y);
    });

    if (!isFinite(x0)) {
      container.innerHTML = '<div style="padding:32px;color:#ff6b35">No warehouse geometry</div>';
      return;
    }

    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const W  = x1 - x0;
    const D  = y1 - y0;

    const scale = 1 / 1000.0;
    const tx = x => (x - cx) * scale;
    const tz = y => (y - cy) * scale;

    // ── Escena ────────────────────────────────────────────────────────────
    const scene = new THREE.Scene();
    // background null → canvas transparent → es veu el mateix fons que el 2D
    scene.background = null;
    scene.fog = new THREE.Fog(
      0x0a0e17,
      Math.max(W, D) * scale * 1.1,
      Math.max(W, D) * scale * 2.6
    );

    const width  = container.clientWidth  || 900;
    const height = container.clientHeight || 600;

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    const maxDim = Math.max(W, D) * scale;
    camera.position.set(maxDim * 0.85, maxDim * 0.70, maxDim * 1.05);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    // Overlay informatiu
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position:absolute; top:16px; left:16px;
      padding:10px 14px; border-radius:12px;
      background:rgba(0,0,0,0.45);
      border:1px solid rgba(255,255,255,0.08);
      backdrop-filter:blur(10px);
      font-size:12px; color:rgba(255,255,255,0.82);
      pointer-events:none; line-height:1.45;
    `;
    overlay.innerHTML = `
      <b style="color:white">3D Warehouse Tour</b><br>
      Slow cinematic camera · ${r.stats.totalBays} bays · ${r.stats.totalLoads} loads · Q ${r.stats.score.toFixed(2)}
    `;
    container.appendChild(overlay);

    // ── Controls ──────────────────────────────────────────────────────────
    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping  = true;
    controls.dampingFactor  = 0.08;
    controls.target.set(0, 0.25, 0);
    controls.maxPolarAngle  = Math.PI * 0.48;
    controls.minDistance    = maxDim * 0.35;
    controls.maxDistance    = maxDim * 2.2;
    controls.rotateSpeed    = 0.45;
    controls.zoomSpeed      = 0.75;

    // ── Il·luminació ──────────────────────────────────────────────────────
    // Hemisfèrica: cel càlid / terra fosc
    scene.add(new THREE.HemisphereLight(0xfff4e0, 0x1a1200, 0.70));

    // Llum clau principal (des de dalt-dreta)
    const key = new THREE.DirectionalLight(0xffffff, 0.90);
    key.position.set(maxDim * 0.6, maxDim * 1.2, maxDim * 0.4);
    key.castShadow = true;
    key.shadow.mapSize.width  = 2048;
    key.shadow.mapSize.height = 2048;
    scene.add(key);

    // Llum de farciment (des de l'altre costat, lleument blava)
    const fill = new THREE.DirectionalLight(0xc8d8ff, 0.45);
    fill.position.set(-maxDim * 0.8, maxDim * 0.5, -maxDim * 0.6);
    scene.add(fill);

    // Llum de terra: punt càlid al centre per omplir ombres baixes
    const ground = new THREE.PointLight(0xffa040, 0.55, maxDim * 2.5);
    ground.position.set(0, 0.3, 0);
    scene.add(ground);

    // ── Materials ─────────────────────────────────────────────────────────
    const matFloor = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 1.0, metalness: 0.0,
      side: THREE.DoubleSide, transparent: true, opacity: 0.0, depthWrite: false
    });
    const matObstacle = new THREE.MeshStandardMaterial({
      color: 0x7a1515, roughness: 0.75, metalness: 0.05, transparent: true, opacity: 0.82
    });
    // Gap: ambre ben visible
    const matGap = new THREE.MeshBasicMaterial({
      color: 0xf59e0b, transparent: true, opacity: 0.22,
      side: THREE.DoubleSide, depthWrite: false
    });
    const matGapEdge = new THREE.LineBasicMaterial({
      color: 0xf59e0b, transparent: true, opacity: 0.85
    });

    // Paleta SWATCH idèntica al 2D de app.py
    const BB_HEX = [0x2563eb, 0xd97706, 0x16a34a, 0xdc2626, 0x7c3aed, 0x0891b2, 0xbe185d, 0x65a30d];

    function bayColorInt(bayId) { return BB_HEX[bayId % BB_HEX.length]; }

    function makeBayMats(bayId) {
      const col = new THREE.Color(bayColorInt(bayId));
      const matColumn = new THREE.MeshStandardMaterial({
        color: col.clone(), roughness: 0.30, metalness: 0.72
      });
      const darkCol = col.clone().multiplyScalar(0.55);
      const matBeam = new THREE.MeshStandardMaterial({
        color: darkCol, roughness: 0.42, metalness: 0.58
      });
      const shelfCol = col.clone().multiplyScalar(0.22);
      const matShelf = new THREE.MeshStandardMaterial({
        color: shelfCol, roughness: 0.60, metalness: 0.40
      });
      const matPallet = new THREE.MeshStandardMaterial({
        color: 0x9b6b36, roughness: 0.90, metalness: 0.02
      });
      // Caixes: color del tipus al 45% (prou reconeixible) mesclat amb cartró clar
      const boxCol = col.clone().lerp(new THREE.Color(0xd4a96a), 0.35);
      const matBox = new THREE.MeshStandardMaterial({
        color: boxCol, roughness: 0.82, metalness: 0.04
      });
      // Cinta: color fosc del tipus (coherent amb el rack)
      const tapeCol = col.clone().multiplyScalar(0.45);
      const matTape = new THREE.MeshStandardMaterial({
        color: tapeCol, roughness: 0.90, metalness: 0.02
      });
      const matBoxEdge = new THREE.LineBasicMaterial({
        color: darkCol, transparent: true, opacity: 0.50
      });
      const matLabel = new THREE.MeshBasicMaterial({
        color: 0xf8fafc, transparent: true, opacity: 0.74
      });
      return { matColumn, matBeam, matShelf, matPallet, matBox, matTape, matBoxEdge, matLabel };
    }

    // ── Terra (shape del warehouse) ───────────────────────────────────────
    const shape = new THREE.Shape();
    wh.forEach((v, i) => {
      const px = tx(v.x), pz = tz(v.y);
      if (i === 0) shape.moveTo(px, pz);
      else shape.lineTo(px, pz);
    });
    shape.closePath();

    const floorGeo = new THREE.ShapeGeometry(shape);
    floorGeo.rotateX(-Math.PI / 2);
    const floor = new THREE.Mesh(floorGeo, matFloor);
    floor.receiveShadow = true;
    scene.add(floor);

    // Contorn del warehouse (línia blava com el 2D)
    const outlinePts = wh.concat([wh[0]]).map(
      v => new THREE.Vector3(tx(v.x), 0.035, tz(v.y))
    );
    scene.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(outlinePts),
      new THREE.LineBasicMaterial({ color: 0x2a6fff })
    ));

    // ── Helpers ───────────────────────────────────────────────────────────
    function addBox(x, y, z, w, h, d, mat, parent) {
      parent = parent || scene;
      const geo  = new THREE.BoxGeometry(Math.max(w,0.01), Math.max(h,0.01), Math.max(d,0.01));
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      mesh.castShadow    = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    }

    function bboxCoords(coords) {
      let ax=Infinity, ay=Infinity, bx=-Infinity, by=-Infinity;
      coords.forEach(c => {
        ax=Math.min(ax,c[0]); ay=Math.min(ay,c[1]);
        bx=Math.max(bx,c[0]); by=Math.max(by,c[1]);
      });
      return { x0:ax, y0:ay, x1:bx, y1:by, w:bx-ax, d:by-ay };
    }

    // ── Gap polys ─────────────────────────────────────────────────────────
    function addGapPoly(coords) {
      if (!coords || coords.length < 3) return;
      const sh = new THREE.Shape();
      coords.forEach((c, i) => {
        const px = tx(c[0]), pz = tz(c[1]);
        if (i === 0) sh.moveTo(px, pz); else sh.lineTo(px, pz);
      });
      sh.closePath();
      const geo  = new THREE.ShapeGeometry(sh);
      geo.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geo, matGap);
      mesh.position.y  = 0.045;
      mesh.renderOrder = 4;
      scene.add(mesh);

      const pts = coords.concat([coords[0]]).map(
        c => new THREE.Vector3(tx(c[0]), 0.055, tz(c[1]))
      );
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), matGapEdge);
      line.renderOrder = 5;
      scene.add(line);
    }

    // ── Rack (estant complet amb pallets i caixes) ────────────────────────
    function addRack(b, index) {
      const bb = bboxCoords(b.footprintCoords || [[b.x,b.y],[b.x+b.w,b.y+b.d]]);

      const xC = tx((bb.x0 + bb.x1) / 2);
      const zC = tz((bb.y0 + bb.y1) / 2);

      const w  = Math.max(bb.w  * scale, 0.05);
      const d  = Math.max(bb.d  * scale, 0.05);
      const h  = Math.max((b.h || 2000) * scale, 0.35);

      const beam   = Math.max(Math.min(w,d) * 0.045, 0.035);
      const levels = Math.max(3, Math.min(5, Math.round(h / 0.75)));

      const mats  = makeBayMats(b.id);
      const group = new THREE.Group();
      scene.add(group);

      function localBox(lx, ly, lz, bw, bh, bd, mat) {
        return addBox(xC + lx, ly, zC + lz, bw, bh, bd, mat, group);
      }

      function localCardboardBox(lx, ly, lz, bw, bh, bd, seed) {
        const box   = localBox(lx, ly, lz, bw, bh, bd, mats.matBox);
        const edges = new THREE.EdgesGeometry(box.geometry);
        const line  = new THREE.LineSegments(edges, mats.matBoxEdge);
        line.position.copy(box.position);
        line.rotation.copy(box.rotation);
        group.add(line);

        // Franja de cinta a dalt
        const tapeW = Math.max(bw * 0.12, 0.025);
        localBox(lx, ly + bh/2 + 0.004, lz, tapeW, 0.008, bd * 0.92, mats.matTape);

        // Etiqueta d'enviament (cada dos caixes)
        if ((seed % 2) === 0) {
          localBox(lx - bw*0.22, ly + bh*0.10, lz - bd/2 - 0.004, bw*0.18, bh*0.22, 0.008, mats.matLabel);
        }
        return box;
      }

      function localCardboardCluster(baseX, baseY, baseZ, areaW, areaD, levelH, seed) {
        const boxW = areaW * 0.82;
        const boxD = areaD * 0.74;
        const boxH = Math.min(levelH * 0.52, 0.40);
        localCardboardBox(baseX, baseY + boxH/2, baseZ, boxW, boxH, boxD, seed);
      }

      // 4 columnes verticals — color primari, metàl·lic
      const xs = [-w/2 + beam/2, w/2 - beam/2];
      const zs = [-d/2 + beam/2, d/2 - beam/2];
      xs.forEach(px => { zs.forEach(pz => { localBox(px, h/2, pz, beam, h, beam, mats.matColumn); }); });

      // Travessers horitzontals per nivell
      for (let i = 0; i <= levels; i++) {
        const yy = Math.max(beam/2, (h / levels) * i);
        localBox(0,            yy, -d/2 + beam/2, w,    beam, beam, mats.matBeam);
        localBox(0,            yy,  d/2 - beam/2, w,    beam, beam, mats.matBeam);
        localBox(-w/2+beam/2,  yy,  0,            beam, beam, d,    mats.matBeam);
        localBox( w/2-beam/2,  yy,  0,            beam, beam, d,    mats.matBeam);

        if (i > 0 && i < levels) {
          localBox(0, yy - beam*0.35, 0, w*0.88, beam*0.35, d*0.82, mats.matShelf);
        }
      }

      // Pallets i caixes per nivell
      for (let i = 1; i < levels; i++) {
        const yy       = (h / levels) * i + beam * 1.7;
        const palletH  = Math.min(0.14, h / levels * 0.20);
        const count    = w > d ? 2 : 1;

        for (let j = 0; j < count; j++) {
          const off = count === 2 ? (j === 0 ? -w*0.23 : w*0.23) : 0;
          localBox(off, yy, 0, w * (count===2 ? 0.34 : 0.62), palletH, d*0.55, mats.matPallet);
          localCardboardCluster(
            off, yy + palletH/2, 0,
            w * (count===2 ? 0.34 : 0.56), d*0.48,
            h / levels, index + i + j + b.id
          );
        }
      }

      // Empremta de terra amb brillantor subtil
      const baseColor = new THREE.Color(bayColorInt(b.id));
      const matBase   = new THREE.MeshBasicMaterial({
        color: baseColor, transparent: true, opacity: 0.12, depthWrite: false
      });
      const base = localBox(0, 0.012, 0, w, 0.018, d, matBase);
      base.castShadow = false;

      // Contorn de l'empremta — coincideix amb el stroke 2D
      const footPts = [
        new THREE.Vector3(xC - w/2, 0.022, zC - d/2),
        new THREE.Vector3(xC + w/2, 0.022, zC - d/2),
        new THREE.Vector3(xC + w/2, 0.022, zC + d/2),
        new THREE.Vector3(xC - w/2, 0.022, zC + d/2),
        new THREE.Vector3(xC - w/2, 0.022, zC - d/2)
      ];
      const footLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(footPts),
        new THREE.LineBasicMaterial({ color: bayColorInt(b.id), transparent: true, opacity: 0.65 })
      );
      footLine.renderOrder = 6;
      scene.add(footLine);

      group.userData.order = index;
      G3D.rackGroups.push(group);
      return group;
    }

    // ── Zones de sostre ───────────────────────────────────────────────────
    if (showCeiling && r.ceiling && r.ceiling.length) {
      const zones         = [...r.ceiling].sort((a,b) => a.x - b.x);
      const ceilingColors = [0x2563eb, 0x16a34a, 0xd97706, 0xdc2626, 0x7c3aed];

      // Sutherland-Hodgman: retalla un polígon subj per un polígon convex clip
      function sutherlandHodgman(subj, clip) {
        function inside(p, a, b) {
          return (b.x-a.x)*(p.y-a.y) - (b.y-a.y)*(p.x-a.x) >= 0;
        }
        function intersect(a, b, c, d) {
          const A1=b.y-a.y, B1=a.x-b.x, C1=A1*a.x+B1*a.y;
          const A2=d.y-c.y, B2=c.x-d.x, C2=A2*c.x+B2*c.y;
          const det = A1*B2 - A2*B1;
          if (Math.abs(det) < 1e-10) return a;
          return { x:(C1*B2-C2*B1)/det, y:(A1*C2-A2*C1)/det };
        }
        let output = subj.slice();
        for (let i=0; i<clip.length; i++) {
          if (output.length === 0) return [];
          const input = output; output = [];
          const A = clip[i], B = clip[(i+1) % clip.length];
          for (let j=0; j<input.length; j++) {
            const P=input[j], Q=input[(j+1) % input.length];
            const Pi=inside(P,A,B), Qi=inside(Q,A,B);
            if (Pi) output.push(P);
            if (Pi !== Qi) output.push(intersect(P,Q,A,B));
          }
        }
        return output;
      }

      function clipPolyByX(poly, minX, maxX) {
        const margin = (y1-y0)*0.02;
        const band = [
          {x:minX, y:y0-margin}, {x:maxX, y:y0-margin},
          {x:maxX, y:y1+margin}, {x:minX, y:y1+margin}
        ];
        const result = sutherlandHodgman(poly.map(p => ({x:p.x, y:p.y})), band);
        if (result.length < 3) return result;
        const clean = [];
        result.forEach(p => {
          const last = clean[clean.length-1];
          if (!last || Math.abs(last.x-p.x)>1e-5 || Math.abs(last.y-p.y)>1e-5) clean.push(p);
        });
        return clean;
      }

      function polygonArea2(poly) {
        let s=0;
        for (let i=0; i<poly.length; i++) {
          const a=poly[i], b=poly[(i+1)%poly.length];
          s += a.x*b.y - b.x*a.y;
        }
        return s/2;
      }

      function roundedRect(ctx, x, y, w, h, r) {
        if (w < 2*r) r=w/2; if (h < 2*r) r=h/2;
        ctx.beginPath();
        ctx.moveTo(x+r, y);
        ctx.arcTo(x+w,y, x+w,y+h, r);
        ctx.arcTo(x+w,y+h, x,y+h, r);
        ctx.arcTo(x,y+h, x,y, r);
        ctx.arcTo(x,y, x+w,y, r);
        ctx.closePath();
      }

      function makeCeilingLabel(text, colorHex, px, py, pz) {
        const canvas  = document.createElement('canvas');
        canvas.width  = 512; canvas.height = 128;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0,0,512,128);
        ctx.fillStyle = 'rgba(0,0,0,0.54)';
        roundedRect(ctx,18,26,476,76,18); ctx.fill();
        ctx.strokeStyle = colorHex; ctx.lineWidth = 4;
        roundedRect(ctx,18,26,476,76,18); ctx.stroke();
        ctx.fillStyle='#ffffff'; ctx.font='700 34px Arial,sans-serif';
        ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.fillText(text, 256, 64);
        const texture  = new THREE.CanvasTexture(canvas);
        const material = new THREE.SpriteMaterial({ map:texture, transparent:true, depthWrite:false });
        const sprite   = new THREE.Sprite(material);
        sprite.position.set(px, py, pz);
        sprite.scale.set(1.35, 0.34, 1);
        sprite.renderOrder = 12;
        scene.add(sprite);
      }

      zones.forEach((c, i) => {
        const start   = Math.max(c.x, x0);
        const end     = i < zones.length-1 ? Math.min(zones[i+1].x, x1) : x1;
        if (end <= start) return;

        const clipped = clipPolyByX(wh, start, end);
        if (!clipped || clipped.length < 3) return;

        const hh         = Math.max((c.h || 1000) * scale, 0.2);
        const zoneColor  = ceilingColors[i % ceilingColors.length];
        const zoneColorObj = new THREE.Color(zoneColor);
        const zoneColorCss = '#' + zoneColorObj.getHexString();

        let roofPoly = clipped.slice();
        if (polygonArea2(roofPoly) < 0) roofPoly = roofPoly.reverse();

        // 1. Superfície de sostre (molt subtil)
        const roofShape = new THREE.Shape();
        roofPoly.forEach((p, idx) => {
          const px = tx(p.x), pz = tz(p.y);
          if (idx === 0) roofShape.moveTo(px, pz); else roofShape.lineTo(px, pz);
        });
        roofShape.closePath();
        const roofGeo = new THREE.ShapeGeometry(roofShape);
        roofGeo.rotateX(-Math.PI/2);
        const roofMat = new THREE.MeshBasicMaterial({
          color:zoneColor, transparent:true, opacity:0.10, side:THREE.DoubleSide, depthWrite:false
        });
        const roof = new THREE.Mesh(roofGeo, roofMat);
        roof.position.y  = hh;
        roof.renderOrder = 8;
        scene.add(roof);

        // 2. Contorn de perímetre a l'alçada del sostre
        const edgeMat  = new THREE.LineBasicMaterial({ color:zoneColor, transparent:true, opacity:0.85 });
        const roofPts  = roofPoly.concat([roofPoly[0]]).map(
          p => new THREE.Vector3(tx(p.x), hh, tz(p.y))
        );
        const roofLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(roofPts), edgeMat);
        roofLine.renderOrder = 10;
        scene.add(roofLine);

        // 3. Parets laterals extrudides des del terra fins al sostre — tots els segments del perímetre
        const wallMat = new THREE.MeshBasicMaterial({
          color: zoneColor, transparent: true, opacity: 0.12,
          side: THREE.DoubleSide, depthWrite: false
        });
        const wallEdgeMat = new THREE.LineBasicMaterial({
          color: zoneColor, transparent: true, opacity: 0.65
        });

        for (let si = 0; si < roofPoly.length; si++) {
          const pA = roofPoly[si];
          const pB = roofPoly[(si + 1) % roofPoly.length];

          const wallPts3D = [
            new THREE.Vector3(tx(pA.x), 0.0, tz(pA.y)),
            new THREE.Vector3(tx(pB.x), 0.0, tz(pB.y)),
            new THREE.Vector3(tx(pB.x), hh,  tz(pB.y)),
            new THREE.Vector3(tx(pA.x), hh,  tz(pA.y))
          ];

          const wallGeo = new THREE.BufferGeometry();
          const verts = new Float32Array([
            wallPts3D[0].x, wallPts3D[0].y, wallPts3D[0].z,
            wallPts3D[1].x, wallPts3D[1].y, wallPts3D[1].z,
            wallPts3D[2].x, wallPts3D[2].y, wallPts3D[2].z,
            wallPts3D[0].x, wallPts3D[0].y, wallPts3D[0].z,
            wallPts3D[2].x, wallPts3D[2].y, wallPts3D[2].z,
            wallPts3D[3].x, wallPts3D[3].y, wallPts3D[3].z
          ]);
          wallGeo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
          const wallMesh = new THREE.Mesh(wallGeo, wallMat);
          wallMesh.renderOrder = 7;
          scene.add(wallMesh);

          const wallLine = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([...wallPts3D, wallPts3D[0]]),
            wallEdgeMat
          );
          wallLine.renderOrder = 8;
          scene.add(wallLine);
        }

        // 4. Etiqueta centrada
        let cxRoof=0, cyRoof=0;
        roofPoly.forEach(p => { cxRoof+=p.x; cyRoof+=p.y; });
        cxRoof /= roofPoly.length; cyRoof /= roofPoly.length;
        makeCeilingLabel(`${Math.round(c.h)} mm`, zoneColorCss, tx(cxRoof), hh+0.16, tz(cyRoof));
      });
    }

    // ── Obstacles ─────────────────────────────────────────────────────────
    (r.obstacles || []).forEach(o => {
      const obsBox = addBox(
        tx(o.x + o.w/2), 0.28, tz(o.y + o.d/2),
        o.w*scale, 0.56, o.d*scale, matObstacle
      );
      const obsEdges = new THREE.EdgesGeometry(obsBox.geometry);
      const obsLine  = new THREE.LineSegments(obsEdges, new THREE.LineBasicMaterial({
        color:0xff3232, transparent:true, opacity:0.90
      }));
      obsLine.position.copy(obsBox.position);
      scene.add(obsLine);
    });

    // ── Gap polys ─────────────────────────────────────────────────────────
    if (showGaps) {
      (r.placed || []).forEach(b => addGapPoly(b.gapCoords));
    }

    // ── Estants ───────────────────────────────────────────────────────────
    G3D.rackGroups = [];
    (r.placed || []).forEach((b, i) => addRack(b, i));
    G3D.rackGroups.forEach(g => { g.visible = true; });

    // ── Desar estat global ────────────────────────────────────────────────
    G3D.camera    = camera;
    G3D.controls  = controls;
    G3D.renderer  = renderer;
    G3D.scene     = scene;
    G3D.maxDim    = maxDim;

    // ── Animació cinematogràfica ──────────────────────────────────────────
    function animate() {
      G3D.animationId = requestAnimationFrame(animate);

      if (G3D.autoTourEnabled) {
        G3D.autoTourAngle = (G3D.autoTourAngle || 0) + 0.0022;

        const radius     = maxDim * 1.35;
        const heightBase = maxDim * 0.58;
        const heightWave = Math.sin(G3D.autoTourAngle * 0.65) * maxDim * 0.10;

        camera.position.x = Math.cos(G3D.autoTourAngle) * radius;
        camera.position.z = Math.sin(G3D.autoTourAngle) * radius;
        camera.position.y = heightBase + heightWave;

        controls.target.set(0, 0.25, 0);
        camera.lookAt(controls.target);
      }

      controls.update();
      renderer.render(scene, camera);
    }

    animate();

    // ── ResizeObserver ────────────────────────────────────────────────────
    const ro = new ResizeObserver(() => {
      const w = container.clientWidth  || width;
      const h = container.clientHeight || height;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    ro.observe(container);
    G3D.resizeObserver = ro;
  }

  // ── Exposar l'API pública ─────────────────────────────────────────────────
  window.render3D      = render3D;
  window.destroy3D     = destroy3D;
  window.set3DCamera   = set3DCamera;

  // Àlies per compatibilitat (apporiol.py usa dispose3D internament)
  window.dispose3D     = destroy3D;

})();