import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

interface ReportBody {
  reporterWallet?: string;
  reportedWallet?: string;
  postSignature?: string;
  reason: string;
  content?: string;
}

export async function POST(req: NextRequest) {
  try {
    const body: ReportBody = await req.json();
    const { reporterWallet, reportedWallet, postSignature, reason, content } = body;

    if (!reason) {
      return NextResponse.json({ error: 'reason required' }, { status: 400 });
    }

    const report = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      reporterWallet: reporterWallet || 'anonymous',
      reportedWallet: reportedWallet || 'unknown',
      postSignature: postSignature || null,
      reason,
      content: content?.slice(0, 500) || null,
    };

    console.log('[REPORT]', JSON.stringify(report));

    // Store in KV if available (same Upstash used for push storage)
    const kvUrl = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
    const kvToken = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

    if (kvUrl && kvToken) {
      // Push to a Redis list so you can review all reports
      await fetch(`${kvUrl}/lpush/reports`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${kvToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(JSON.stringify(report)),
      });
    }

    // Send email notification if REPORT_EMAIL and RESEND_API_KEY are set
    const resendKey = process.env.RESEND_API_KEY;
    const reportEmail = process.env.REPORT_EMAIL || 'shaann950@gmail.com';

    if (resendKey) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'reports@shyft.lol',
          to: reportEmail,
          subject: `[Shyft Report] ${reason} — ${report.id}`,
          text: `New content report received.\n\nReason: ${reason}\nReporter: ${reporterWallet || 'anonymous'}\nReported: ${reportedWallet || 'unknown'}\nPost: ${postSignature || 'N/A'}\nContent: ${content || 'N/A'}\nTime: ${report.timestamp}`,
        }),
      });
    }

    return NextResponse.json({ success: true, reportId: report.id });
  } catch (err) {
    console.error('[report route]', err);
    return NextResponse.json({ error: 'internal error' }, { status: 500 });
  }
}

// GET /api/report?secret=... — admin view of all reports
export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const kvUrl = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const kvToken = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

  if (!kvUrl || !kvToken) {
    return NextResponse.json({ error: 'no KV configured' }, { status: 503 });
  }

  const res = await fetch(`${kvUrl}/lrange/reports/0/99`, {
    headers: { Authorization: `Bearer ${kvToken}` },
  });
  const data = await res.json();
  const reports = (data.result || []).map((r: string) => {
    try { return JSON.parse(r); } catch { return r; }
  });

  return NextResponse.json({ count: reports.length, reports });
}
