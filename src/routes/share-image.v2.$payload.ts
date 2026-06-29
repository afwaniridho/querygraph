import { createFileRoute } from "@tanstack/react-router";
import {
	renderFallbackShareImageSvg,
	renderShareImageSvg,
} from "#/lib/share-preview";
import { decodeShareState } from "#/lib/share-url";

const BASE_HEADERS = {
	"Content-Type": "image/svg+xml; charset=utf-8",
	"Content-Security-Policy":
		"default-src 'none'; style-src 'unsafe-inline'; sandbox",
	"X-Content-Type-Options": "nosniff",
	"X-Frame-Options": "DENY",
	"Referrer-Policy": "no-referrer",
} as const;

export const Route = createFileRoute("/share-image/v2/$payload")({
	server: {
		handlers: {
			GET: ({ params }) => {
				const decoded = decodeShareState(params.payload);
				if (!decoded.ok) {
					return new Response(renderFallbackShareImageSvg(), {
						status: 400,
						headers: {
							...BASE_HEADERS,
							"Cache-Control": "no-store",
							"X-Robots-Tag": "noindex, nofollow",
						},
					});
				}
				try {
					return new Response(
						renderShareImageSvg(decoded.state.dialect, decoded.state.preview),
						{
							headers: {
								...BASE_HEADERS,
								"Cache-Control": "public, max-age=31536000, immutable",
								"X-Robots-Tag": "noindex, nofollow",
							},
						},
					);
				} catch {
					return new Response(renderFallbackShareImageSvg(), {
						status: 500,
						headers: {
							...BASE_HEADERS,
							"Cache-Control": "no-store",
							"X-Robots-Tag": "noindex, nofollow",
						},
					});
				}
			},
		},
	},
});
