import { NextRequest, NextResponse } from "next/server";

// Proxy to Tenor (Google's GIF service). Free unlimited with a key.
// Falls back to Giphy if TENOR_KEY is missing.
//
// Set in Vercel env:
//   TENOR_API_KEY=AIzaSy...   (https://developers.google.com/tenor/guides/quickstart)
//   GIPHY_API_KEY=xxxxxxxx    (https://developers.giphy.com/dashboard/?create=true)

export const runtime = "edge";

const ALLOWED_ORIGINS = [
  "https://shyft.lol",
  "https://www.shyft.lol",
  "http://localhost:3000",
  "http://localhost:8081",
  "http://localhost:8082",
  "http://localhost:8083",
];

function corsHeaders(origin: string | null) {
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : "*";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "public, max-age=300, s-maxage=300",
  };
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}

export async function GET(req: NextRequest) {
  const origin = req.headers.get("origin");
  const headers = corsHeaders(origin);
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim();
  const limit = Math.min(Math.max(Number(searchParams.get("limit") || 24), 1), 50);

  const TENOR_KEY = process.env.TENOR_API_KEY;
  const GIPHY_KEY = process.env.GIPHY_API_KEY;

  try {
    // Prefer Tenor (more permissive, better SFW filter)
    if (TENOR_KEY) {
      const endpoint = q
        ? `https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(q)}&key=${TENOR_KEY}&client_key=shyft&limit=${limit}&contentfilter=medium&media_filter=tinygif,gif`
        : `https://tenor.googleapis.com/v2/featured?key=${TENOR_KEY}&client_key=shyft&limit=${limit}&contentfilter=medium&media_filter=tinygif,gif`;
      const res = await fetch(endpoint);
      if (!res.ok) throw new Error(`tenor ${res.status}`);
      const data = await res.json();
      const items = (data.results || []).map((g: any) => {
        const tiny = g.media_formats?.tinygif;
        const full = g.media_formats?.gif;
        return {
          id: g.id,
          url: full?.url || tiny?.url,
          preview: tiny?.url || full?.url,
          width: Number(tiny?.dims?.[0] || full?.dims?.[0] || 200),
          height: Number(tiny?.dims?.[1] || full?.dims?.[1] || 200),
        };
      }).filter((x: any) => x.url);
      return NextResponse.json({ provider: "tenor", items }, { headers });
    }

    if (GIPHY_KEY) {
      const endpoint = q
        ? `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_KEY}&q=${encodeURIComponent(q)}&limit=${limit}&rating=pg-13&bundle=messaging_non_clips`
        : `https://api.giphy.com/v1/gifs/trending?api_key=${GIPHY_KEY}&limit=${limit}&rating=pg-13&bundle=messaging_non_clips`;
      const res = await fetch(endpoint);
      if (!res.ok) throw new Error(`giphy ${res.status}`);
      const data = await res.json();
      const items = (data.data || []).map((g: any) => ({
        id: g.id,
        url: g.images?.downsized?.url || g.images?.original?.url,
        preview: g.images?.fixed_width_downsampled?.url || g.images?.fixed_width?.url,
        width: Number(g.images?.fixed_width?.width || 200),
        height: Number(g.images?.fixed_width?.height || 200),
      })).filter((x: any) => x.url);
      return NextResponse.json({ provider: "giphy", items }, { headers });
    }

    return NextResponse.json(
      { items: [], error: "No GIF API key configured. Set TENOR_API_KEY or GIPHY_API_KEY in Vercel env." },
      { headers, status: 500 },
    );
  } catch (err: any) {
    return NextResponse.json({ items: [], error: err?.message || "Failed to fetch GIFs" }, { headers, status: 500 });
  }
}
