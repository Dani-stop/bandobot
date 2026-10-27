import { NextResponse } from "next/server";
import { listBandi } from "@/lib/search";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await listBandi());
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Impossibile caricare i bandi." }, { status: 500 });
  }
}
