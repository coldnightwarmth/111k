// Sculpted from the four user-supplied Drilady ear / hair reference cutouts.
// Hair lives in the existing head picker and retains the accepted bunny face.
export const DRILADY_BUNNY_STUDY = Object.freeze({
 ears: [
  {id:'ladyrefalert',label:'Alert petals',upright:true,design:'Upright tapered ears with deep rose inner cups'},
  {id:'ladyrefvsplay',label:'Open V ears',upright:true,design:'Broad outward-facing ears with rounded rims'},
  {id:'ladyreftulip',label:'Tulip ears',upright:true,design:'Inward-curving upright ears with softly cupped tips'},
  {id:'ladyrefperkfold',label:'Perk & fold',upright:true,design:'One alert ear and one forward-folded ear'},
  {id:'ladyrefbackswept',label:'Windswept ears',upright:true,design:'Upright ears swept backward through depth'},
  {id:'ladyreftipcurl',label:'Curled-tip ears',upright:true,design:'Raised ears with outward rolled tips'},
  {id:'ladyrefclassiclop',label:'Silk lop ears',design:'Long tapered hanging ears inspired by the original cutout'},
  {id:'ladyrefwinglop',label:'Winged lop ears',design:'Flared hanging ears with open inner panels'},
  {id:'ladyrefasymmetric',label:'Lazy fold ears',design:'One ear drapes low while the other folds sideways'},
  {id:'ladyrefforward',label:'Forward flop ears',design:'Paired forward folds with thick soft tips'},
 ].map(row=>({...row,source:'User Drilady references · IMG_8017 / IMG_8015 / IMG_8016 / IMG_9763'})),
 head: [
  {id:'ladyrefcaramel',label:'Caramel sweep',design:'Continuous side-swept cap with sculpted fringe and tapered nape'},
  {id:'ladyrefhoneybraids',label:'Honey plaits',design:'Center-parted hair and two broad interwoven braids'},
  {id:'ladyrefsidebraid',label:'Over-shoulder braid',design:'Swept fringe feeding a single thick braid'},
  {id:'ladyrefcurtains',label:'Honey curtain bob',design:'Center-parted rounded layers that turn beneath the jaw'},
  {id:'ladyrefplumpony',label:'Plum-tie ponytail',design:'Swept crown, gathered ponytail and sculpted violet scrunchie'},
 ].map(row=>({...row,baseHead:true,source:'User Drilady references · IMG_8015 / IMG_9763'})),
});
