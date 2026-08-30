/**
 * GET /api/place-photo
 *
 * Paid photo egress is intentionally disabled. Keep the legacy endpoint alive
 * so stored plans and older clients receive a valid image response without
 * contacting an external service.
 */

export const config = { runtime: 'edge' };

const PLACEHOLDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500" aria-hidden="true" focusable="false">
  <rect width="800" height="500" fill="#f3f4f6"/>
  <circle cx="610" cy="145" r="52" fill="#d1d5db"/>
  <path d="M95 405 270 225l115 115 82-82 238 147H95Z" fill="#d1d5db"/>
  <path d="m95 405 175-180 115 115 82-82 238 147" fill="none" stroke="#9ca3af" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

export default function handler() {
  return new Response(PLACEHOLDER_SVG, {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=86400, s-maxage=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
