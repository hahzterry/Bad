"""
Generate human-quality voice-over audio for the SHYFT presentation.
Uses Microsoft Edge neural TTS (free, no API key) — voice: en-US-AndrewNeural
Output: /Users/shaan/private/Shyft/public/voice/slide-N.mp3
"""
import asyncio, os
import edge_tts

VOICE = "en-US-AndrewNeural"   # warm, confident, authentic male
OUT_DIR = "/Users/shaan/private/Shyft/public/voice"
os.makedirs(OUT_DIR, exist_ok=True)

# One narration per slide. Keep natural cadence with commas.
SLIDES = [
    # 1 - Intro
    "This is Shift. Social media, rebuilt on Solana. Every post, every follow, every direct message is a real on-chain action. No fake ownership. No platform lock-in. Just social media that you actually own.",
    # 2 - Problem
    "Today's social platforms are closed databases. Creators build audiences they don't own, monetization is opaque, and users get trapped inside algorithmic feeds with weak privacy. The system is broken — and people are ready for an alternative.",
    # 3 - Solution
    "Shift fixes this. We combine embedded wallets, treasury-sponsored gas, end-to-end encrypted messaging, and creator token rails into one consumer app. It feels familiar, but every meaningful action is on-chain and verifiable.",
    # 4 - Why Now (integrations)
    "The timing is finally right. Privy removes wallet friction with seamless social login. Bags powers creator tokenization. And MagicBlock enables truly private, peer-to-peer payments. Together, this is the consumer-ready stack we've been waiting for.",
    # 5 - Architecture
    "Under the hood, Shift runs on a hybrid architecture. Social state lives on Solana through our Anchor program. Token rails plug in via the Bags SDK. And our treasury sponsorship API silently co-signs every transaction, so users pay zero fees.",
    # 6 - Mobile Live
    "Shift is live on the iOS App Store. Native onboarding, push notifications, encrypted chat, and on-chain payments — all in your pocket. This isn't a prototype. It's a real, downloadable, working product.",
    # 7 - Roadmap
    "Next, we're going deep on creator tooling, growth loops, and monetization. The mission is simple: make on-chain social mainstream, with the polish people expect from the apps they use every day.",
    # 8 - Closing
    "Shift is not another social clone. It's a product-ready on-chain social network with live mobile distribution, real users, and real ownership. Download it today, and join the network.",
]

async def main():
    for i, text in enumerate(SLIDES, 1):
        out = os.path.join(OUT_DIR, f"slide-{i}.mp3")
        print(f"→ generating {out}")
        # rate slightly slower for clarity, default pitch
        comm = edge_tts.Communicate(text, VOICE, rate="-4%", pitch="-2Hz")
        await comm.save(out)
    print("✓ done")

asyncio.run(main())
