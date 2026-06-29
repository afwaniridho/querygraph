import { createFileRoute, Link } from "@tanstack/react-router";
import { QueryGraphShell } from "#/components/QueryGraphShell";
import { previewDescription, previewTitle } from "#/lib/share-preview";
import {
	buildShareImagePath,
	decodeShareState,
	type ShareDecodeError,
} from "#/lib/share-url";

const PUBLIC_ORIGIN = "https://querygraph.ridhoafwani.dev";
const FALLBACK_TITLE = "QueryGraph shared SQL visualization";
const FALLBACK_DESCRIPTION =
	"Open a shared PostgreSQL or MySQL query as an interactive logical flowchart.";

function invalidMessage(error: ShareDecodeError): string {
	switch (error) {
		case "unsupported-version":
			return "This link uses a sharing format this version of QueryGraph does not support.";
		case "encoded-too-large":
		case "decoded-too-large":
		case "content-too-large":
			return "This shared query exceeds QueryGraph’s safe self-contained link limits.";
		default:
			return "This shared-query link is incomplete or damaged.";
	}
}

export const Route = createFileRoute("/share/v2/$payload")({
	headers: () => ({
		"Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
		"Content-Security-Policy":
			"default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' https://cdn.jsdelivr.net ws: wss:; worker-src 'self' blob: https://cdn.jsdelivr.net; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
		"Referrer-Policy": "no-referrer",
		"X-Content-Type-Options": "nosniff",
		"X-Frame-Options": "DENY",
		"X-Robots-Tag": "noindex, nofollow",
	}),
	loader: ({ params }) => {
		const decoded = decodeShareState(params.payload);
		return decoded.ok
			? {
					ok: true as const,
					dialect: decoded.state.dialect,
					preview: decoded.state.preview,
				}
			: { ok: false as const, error: decoded.error };
	},
	head: ({ loaderData, params }) => {
		const validState = loaderData?.ok ? loaderData : null;
		const canonical = `${PUBLIC_ORIGIN}/share/v2/${params.payload}`;
		const image = `${PUBLIC_ORIGIN}${buildShareImagePath(params.payload)}`;
		const title = validState
			? previewTitle(validState.dialect, validState.preview)
			: FALLBACK_TITLE;
		const description = validState
			? previewDescription(validState.dialect, validState.preview)
			: FALLBACK_DESCRIPTION;
		return {
			meta: [
				{ title: `${title} — QueryGraph` },
				{ name: "description", content: description },
				{ name: "robots", content: "noindex, nofollow" },
				{ property: "og:type", content: "website" },
				{ property: "og:site_name", content: "QueryGraph" },
				{ property: "og:title", content: title },
				{ property: "og:description", content: description },
				{ property: "og:url", content: canonical },
				{ property: "og:image", content: image },
				{ property: "og:image:type", content: "image/svg+xml" },
				{ property: "og:image:width", content: "1200" },
				{ property: "og:image:height", content: "630" },
				{ name: "twitter:card", content: "summary_large_image" },
				{ name: "twitter:title", content: title },
				{ name: "twitter:description", content: description },
				{ name: "twitter:image", content: image },
			],
			links: [{ rel: "canonical", href: canonical }],
		};
	},
	component: SharedQueryPage,
});

function SharedQueryPage() {
	const loaderResult = Route.useLoaderData();
	const { payload } = Route.useParams();
	const result = decodeShareState(payload);
	if (!result.ok) {
		return (
			<main className="flex min-h-dvh items-center justify-center bg-paper px-5">
				<section className="w-full max-w-lg rounded-lg border border-rule bg-paper-2 p-7 text-center">
					<p className="font-mono text-xs tracking-widest text-accent uppercase">
						Shared query unavailable
					</p>
					<h1 className="mt-3 font-display text-3xl font-semibold text-ink">
						We couldn’t open this link
					</h1>
					<p className="mt-3 text-sm leading-relaxed text-ink-3">
						{invalidMessage(
							loaderResult.ok ? result.error : loaderResult.error,
						)}
					</p>
					<Link
						to="/"
						className="mt-6 inline-flex rounded bg-ink px-4 py-2 font-mono text-xs text-paper"
					>
						Open QueryGraph
					</Link>
				</section>
			</main>
		);
	}
	return <QueryGraphShell initialShareState={result.state} isShared={true} />;
}
