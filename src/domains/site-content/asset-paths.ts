// V-C2: the only places a website picture is addressed. Pure, so any screen can use it without loading storage code.
const PUBLIC_ASSET_PATH = /^\/api\/site-media\/([A-Za-z0-9_-]+)$/;

export function publicAssetPath(assetId: string): string { return `/api/site-media/${assetId}`; }
export function draftAssetPath(assetId: string): string { return `/api/desk/site-media/${assetId}`; }
export function assetIdFromPublicPath(path: string): string | null { return PUBLIC_ASSET_PATH.exec(path)?.[1] ?? null; }
