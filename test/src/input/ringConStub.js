// joy-con-webhid 0.6.x imports ./connectRingCon.js but doesn't ship it. We never use the Ring-Con,
// so vite.config.ts points that import here.
export const connectRingCon = async () => {
  throw new Error('Ring-Con is not supported');
};
