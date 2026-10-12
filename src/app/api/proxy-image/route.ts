import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) return new NextResponse("Missing url", { status: 400 });

  // Only proxy HTTP images (HTTPS images load fine directly)
  if (!url.startsWith("http://")) return NextResponse.redirect(url);

  try {
    const res = await fetch(url);
    if (!res.ok) return new NextResponse("Failed to fetch image", { status: 502 });

    const contentType = res.headers.get("content-type") || "image/jpeg";
    const buffer = await res.arrayBuffer();

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch {
    return new NextResponse("Proxy error", { status: 502 });
  }
}
