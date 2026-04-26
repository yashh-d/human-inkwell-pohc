// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getAddress, verifyMessage } from "https://esm.sh/ethers@6.13.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Body = {
  message: string;
  signature: string;
  chain_id: number;
  contract_address: string;
  entry_id: number;
  author_address: string;
  transaction_hash: string;
  content_hash: string;
  human_signature_hash: string;
  world_id_nullifier?: string | null;
  is_verified: boolean;
  keystroke_count: number;
  typing_speed_scaled: number;
  block_number?: number | null;
  block_timestamp?: string | null;
  gas_used?: string | null;
};

function buildExpectedMessage(
  p: Omit<Body, "message" | "signature" | "block_number" | "block_timestamp" | "gas_used">
): string {
  const nullifier = p.world_id_nullifier ?? "";
  return [
    "Human Inkwell ledger index",
    `chain:${p.chain_id}`,
    `entry:${p.entry_id}`,
    `contract:${p.contract_address.toLowerCase()}`,
    `author:${p.author_address.toLowerCase()}`,
    `contentHash:${p.content_hash}`,
    `humanSigHash:${p.human_signature_hash}`,
    `tx:${p.transaction_hash.toLowerCase()}`,
    `isVerified:${p.is_verified ? "1" : "0"}`,
    `nullifier:${nullifier}`,
  ].join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  try {
    const body = (await req.json()) as Body;
    const {
      message,
      signature,
      chain_id,
      contract_address,
      entry_id,
      author_address,
      transaction_hash,
      content_hash,
      human_signature_hash,
      is_verified,
      keystroke_count,
      typing_speed_scaled,
      block_number,
      block_timestamp,
      gas_used,
    } = body;
    if (
      !message ||
      !signature ||
      chain_id == null ||
      !contract_address ||
      entry_id == null ||
      !author_address ||
      !transaction_hash ||
      !content_hash ||
      !human_signature_hash
    ) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const expected = buildExpectedMessage({
      chain_id: Number(chain_id),
      contract_address: contract_address.trim(),
      entry_id: Number(entry_id),
      author_address: author_address.trim(),
      transaction_hash: transaction_hash.trim(),
      content_hash: content_hash.trim(),
      human_signature_hash: human_signature_hash.trim(),
      world_id_nullifier: body.world_id_nullifier,
      is_verified: Boolean(is_verified),
      keystroke_count: Number(keystroke_count),
      typing_speed_scaled: Number(typing_speed_scaled),
    });

    if (message !== expected) {
      return new Response(
        JSON.stringify({ error: "Message mismatch — do not modify signed payload" }),
        { status: 401, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    const recovered = verifyMessage(message, signature);
    if (getAddress(recovered) !== getAddress(author_address)) {
      return new Response(JSON.stringify({ error: "Invalid signature for author_address" }), {
        status: 401,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) {
      return new Response(JSON.stringify({ error: "Server not configured" }), {
        status: 500,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(url, key, { auth: { persistSession: false } });
    const row = {
      chain_id: Number(chain_id),
      contract_address: contract_address.toLowerCase(),
      entry_id: Number(entry_id),
      author_address: author_address.toLowerCase(),
      transaction_hash: transaction_hash.toLowerCase(),
      content_hash: content_hash.trim(),
      human_signature_hash: human_signature_hash.trim(),
      world_id_nullifier: body.world_id_nullifier || null,
      is_verified: Boolean(is_verified),
      keystroke_count: Number(keystroke_count),
      typing_speed_scaled: Number(typing_speed_scaled),
      block_number: block_number != null ? Number(block_number) : null,
      block_timestamp: block_timestamp || null,
      gas_used: gas_used || null,
    };

    const { error } = await supabase.from("ledger_submissions").insert(row);
    if (error) {
      if (error.code === "23505" || /duplicate|unique/i.test(String(error.message))) {
        return new Response(JSON.stringify({ ok: true, deduped: true }), {
          status: 200,
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }
      console.error(error);
      return new Response(JSON.stringify({ error: error.message || "Insert failed" }), {
        status: 500,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Error" }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
