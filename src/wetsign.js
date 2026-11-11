// The bathroom's (B-05) wet floor sign: a yellow A-frame, its two boards hinged together at the top under a carry
// handle, spread at the bottom, CAUTION / WET FLOOR and the slipping figure printed on both sides, scuffed and
// faded the way they get. (It used to be two loose boards baked into the level: tools/rooms.py.)
import * as THREE from 'three';
import {roomFrame} from './room-frame.js';

const ROOM = 4, DOOR = 1.22, AT = [.2, -.6], TURN = .6;     // as tools/rooms.py had it
const W = .3, H = .64, A = .2;                              // board width, length, half the angle between them

function face() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 544;
  const g = c.getContext('2d');
  let s = 4321; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  g.fillStyle = '#f2c418'; g.fillRect(0, 0, 256, 544);
  // a little uneven: sun-faded patches, grime toward the bottom
  for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(255,240,170,${rnd() * .12})`; g.beginPath(); g.ellipse(rnd() * 256, rnd() * 544, 10 + rnd() * 40, 6 + rnd() * 30, rnd() * 3, 0, 7); g.fill(); }
  const grime = g.createLinearGradient(0, 300, 0, 544); grime.addColorStop(0, 'rgba(60,45,10,0)'); grime.addColorStop(1, 'rgba(60,45,10,.35)');
  g.fillStyle = grime; g.fillRect(0, 0, 256, 544);
  // the print
  g.fillStyle = '#141414';
  g.fillRect(10, 10, 236, 6); g.fillRect(10, 528, 236, 6); g.fillRect(10, 10, 6, 524); g.fillRect(240, 10, 6, 524);
  g.textAlign = 'center'; g.font = 'bold 46px Arial, Helvetica, sans-serif'; g.fillText('CAUTION', 128, 74);
  g.fillRect(28, 92, 200, 5);
  // the warning triangle with someone going over
  g.lineWidth = 12; g.lineJoin = 'round'; g.strokeStyle = '#141414';
  g.beginPath(); g.moveTo(128, 130); g.lineTo(220, 300); g.lineTo(36, 300); g.closePath(); g.stroke();
  g.lineCap = 'round'; g.lineWidth = 10;
  g.beginPath(); g.arc(150, 188, 13, 0, 7); g.fill();                     // head
  g.beginPath(); g.moveTo(140, 204); g.lineTo(112, 244); g.stroke();      // body, leaning back
  g.beginPath(); g.moveTo(112, 244); g.lineTo(150, 262); g.lineTo(168, 248); g.stroke();   // leg kicking out
  g.beginPath(); g.moveTo(112, 244); g.lineTo(92, 280); g.stroke();       // the other
  g.beginPath(); g.moveTo(132, 214); g.lineTo(166, 214); g.stroke();      // arms out
  g.beginPath(); g.moveTo(132, 214); g.lineTo(104, 202); g.stroke();
  g.lineWidth = 5; g.beginPath(); g.moveTo(60, 290); g.lineTo(196, 290); g.stroke();   // the floor
  g.font = 'bold 50px Arial, Helvetica, sans-serif'; g.fillText('WET', 128, 380); g.fillText('FLOOR', 128, 436);
  g.font = 'bold 22px Arial, Helvetica, sans-serif'; g.fillText('PISO MOJADO', 128, 486);
  // scuffs and scratches through the print, chips at the edges
  g.globalCompositeOperation = 'source-atop';
  for (let i = 0; i < 90; i++) {
    g.strokeStyle = `rgba(${rnd() < .5 ? '255,236,150' : '70,55,20'},${.15 + rnd() * .3})`; g.lineWidth = .6 + rnd() * 1.6;
    const x = rnd() * 256, y = rnd() * 544, a = rnd() * 6.28, l = 6 + rnd() * 30;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  for (let i = 0; i < 30; i++) { g.fillStyle = `rgba(90,80,60,${.3 + rnd() * .4})`; const e = rnd() < .5; g.fillRect(e ? (rnd() < .5 ? 0 : 250) : rnd() * 256, e ? rnd() * 544 : (rnd() < .5 ? 0 : 538), 3 + rnd() * 5, 3 + rnd() * 5); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

export function createWetSign(scene) {
  const f = roomFrame(ROOM, DOOR), p = f.toWorld(AT[0], AT[1]);
  const root = new THREE.Group(); root.name = 'wet-sign';
  root.position.set(p.x, 0, p.z); root.rotation.y = f.yaw + TURN;
  const map = face();
  const printed = new THREE.MeshStandardMaterial({map, roughness: .55, metalness: 0});
  const plastic = new THREE.MeshStandardMaterial({color: 0xe0b412, roughness: .6, metalness: 0});
  const top = H * Math.cos(A);
  for (const side of [-1, 1]) {
    // a board hung from the hinge at the top, leant out by A
    const hinge = new THREE.Group(); hinge.position.y = top; hinge.rotation.x = side * A; root.add(hinge);
    const board = new THREE.Mesh(new THREE.BoxGeometry(W, H, .012), [plastic, plastic, plastic, plastic, printed, printed]);
    board.position.set(0, -H / 2, side * .007); hinge.add(board);
    // the back face (-z) shows the print the right way round from outside too: turn its uvs
    if (side < 0) board.rotation.y = Math.PI;
  }
  // the hinge pin and the carry handle on top
  const dark = new THREE.MeshStandardMaterial({color: 0xc9a10f, roughness: .5});
  const pin = new THREE.Mesh(new THREE.CylinderGeometry(.012, .012, W + .01, 10), dark); pin.rotation.z = Math.PI / 2; pin.position.y = top; root.add(pin);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(.05, .012, 6, 16, Math.PI), plastic); handle.position.y = top + .005; root.add(handle);
  root.traverse(o => { if (o.isMesh) { o.matrixAutoUpdate = false; o.updateMatrix(); } });
  root.updateMatrix(); root.matrixAutoUpdate = false;
  scene.add(root);
  return root;
}
