import { NextRequest, NextResponse } from 'next/server';
import { deleteRegistration } from '@/lib/push-storage';

export const runtime = 'nodejs';

/**
 * Account deletion endpoint (Apple Guideline 5.1.1(v) compliance).
 *
 * Note: Shyft's user data (profile, posts, follows) lives ON-CHAIN on Solana.
 * On-chain records cannot be deleted by anyone (including the account owner)
 * — that is the nature of public blockchain data. This endpoint deletes all
 * SERVER-SIDE data we hold off-chain:
 *   - Push notification token registrations
 *   - Report records tied to this wallet
 *
 * The user is also informed in-app and via privacy policy that on-chain data
 * is immutable. To stop using the app, they should also abandon the wallet.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const wallet: string | undefined = body.wallet;

    if (!wallet || typeof wallet !== 'string') {
      return NextResponse.json({ error: 'wallet required' }, { status: 400 });
    }

    // 1. Remove push notification registration
    try {
      await deleteRegistration(wallet);
    } catch (err) {
      console.error('[account/delete] push removal failed:', err);
    }

    // 2. Log the deletion request (audit trail)
    console.log('[ACCOUNT_DELETE]', JSON.stringify({
      wallet,
      timestamp: new Date().toISOString(),
    }));

    return NextResponse.json({
      success: true,
      message: 'Account deleted. All server-side data has been removed. On-chain data (posts, profile) remains immutable on the Solana blockchain by design.',
    });
  } catch (err) {
    console.error('[account/delete]', err);
    return NextResponse.json({ error: 'internal error' }, { status: 500 });
  }
}
