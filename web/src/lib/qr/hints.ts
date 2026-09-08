// What each control of the QR section means, in plain words: one or two
// sentences each, in the learn page's register. The labels beside the
// controls stay short; the explanation lives here, shown by a `Hint`.
import { EC_LEVELS, EC_RECOVERS, MODE_NOTE_BYTE, CENTRE_LABEL_MAX, IMAGE_MAX_BYTES, STOPS_MAX } from './options';

/** The error-correction option labels: the level and what it recovers,
 *  from the one table the hint and the readout also use. */
export const EC_LABEL = (level: (typeof EC_LEVELS)[number]): string => `${level} ${EC_RECOVERS[level]}`;

export const HINTS = {
  presets: 'Two starting points: the plain black-and-white code, or the site’s own look with the logo. Reset puts every setting back to its default.',
  size: 'How wide the code is drawn on this page, in pixels. It does not change the exported files.',
  margin:
    'Blank space around the code, counted in modules (the small squares). Scanners want about 4; less looks tighter but some phones struggle.',
  padding: 'Extra room between that blank space and the edge of the image, in modules, for when a caption or the logo needs it.',
  shape: 'Square keeps the image a square. Circle cuts the background to a disc and scatters a few extra dots in the ring around the code, which stays square and readable.',
  version: 'The grid size, 1 (21×21) to 40 (177×177); auto picks the smallest that fits.',
  level: `How much of the code can be damaged or covered and still scan: ${EC_LEVELS.map(EC_LABEL).join(', ')}; higher means a denser code.`,
  mode: `How the link’s characters are packed. Auto lets the encoder pick the tightest mix, which is what gives the qr-alpha alphabet its small codes; byte ${MODE_NOTE_BYTE}.`,
  mask: 'One of eight patterns the code is XOR-ed with so its dark and light areas stay balanced. Auto picks the best-scoring one; a fixed one changes the look, never the content.',
  style: 'The shape of the small squares that carry the data. Rounded and classy soften them; dots turns them into circles; nanourl is the site’s own look.',
  roundSize: 'Snap the on-screen width so every module is a whole number of pixels, which keeps the edges crisp.',
  dots: 'The colour of the data modules, or a gradient across them. The three big corner squares and the background have their own settings.',
  cornersSquare: 'The outer ring of the three big corner squares that a scanner finds first. Their shape and colour can differ from the data modules.',
  cornersDot: 'The solid centre of the three big corner squares. Its shape and colour can differ from the ring around it.',
  inherit: 'Same as the data modules, or its own colour or gradient.',
  gradient: 'A blend between colours instead of one flat colour. Linear runs in a straight line at the angle you set; radial spreads out from the centre.',
  rotation: 'The direction a linear gradient runs, in degrees: 0 is left to right, 90 top to bottom.',
  stops: `The colours the gradient passes through and where, from 0 (start) to 1 (end); up to ${STOPS_MAX}.`,
  background: 'What sits behind the code: a colour, a gradient, or nothing at all (transparent, for putting the code over something else).',
  backgroundRound: 'Rounds the corners of the image itself, from 0 (square) to 1 (fully round).',
  onDark: 'Draws the code light on dark instead of dark on light. Today’s phone cameras read it; some older scanners cannot, so keep the normal way for print.',
  image: `A picture on the centre of the code: the site’s logo, or a file of your own up to ${Math.round(IMAGE_MAX_BYTES / 1024)} KB. The code keeps scanning because the error-correction level covers what the picture hides.`,
  imageSize: 'How big the picture is, as a share of the code’s width. It is capped by the error-correction level, since the picture hides part of the code.',
  imageMargin: 'A gap between the picture and the modules around it, in pixels of the exported image.',
  hideBackgroundDots: 'Clears the modules behind the picture so it sits on a plain plate instead of over the pattern.',
  caption: 'Text drawn under the code inside the image, for example the short link. It is a picture of words, not part of what the code says.',
  centreLabel: `A word of up to ${CENTRE_LABEL_MAX} characters drawn on a plate in the middle of the code instead of a picture.`,
  format: 'The file to save: PNG (sharp, any background), JPEG (small, no transparency), WebP (small, transparent), or SVG (scales to any size).',
  quality: 'For JPEG and WebP: how much detail to keep, from 0.05 (tiny file) to 1 (best).',
  scale: 'How many pixels each module gets in the exported PNG; 8 gives a 25-module code about 200 px wide.',
  fileName: 'The name of the saved file. Empty uses the code itself.',
  save: 'Download saves the file in the chosen format; SVG is always there too; Copy image puts a PNG on the clipboard for pasting into a chat or a document.',
} as const;

export type HintKey = keyof typeof HINTS;
