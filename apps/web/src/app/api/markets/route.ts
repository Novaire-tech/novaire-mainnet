import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const response = await fetch('https://api.coindcx.com/exchange/v1/markets_details', {
      headers: {
        'Accept': 'application/json',
      },
      next: { revalidate: 60 }
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `CoinDCX API responded with status: ${response.status}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching from CoinDCX API:', error);
    return NextResponse.json(
      { error: 'Failed to fetch markets from exchange' },
      { status: 500 }
    );
  }
}
