import { TransactionIntent } from "./types";
import { sendTransaction } from "./evm";

function buildISO20022(intent: TransactionIntent, txHash: string) {
  const timestamp = new Date().toISOString();
  const execDate = timestamp.split("T")[0];
  const amountVal = intent.amount !== null ? intent.amount : 0;
  const currencyVal = intent.currency || "STT";
  const recipientVal = intent.recipient || "UNSPECIFIED";
  const referenceVal = intent.reference || "UNSPECIFIED";

  return {
    Document: {
      _attributes: {
        xmlns: "urn:iso:std:iso:20022:tech:xsd:pain.001.001.09",
      },
      CstmrCdtTrfInitn: {
        GrpHdr: {
          MsgId: txHash,
          CreDtTm: timestamp,
          NbOfTxs: "1",
          CtrlSum: amountVal.toString(),
          InitgPty: {
            Nm: "VeloRail Gateway",
          },
        },
        PmtInf: {
          PmtInfId: `PI-${txHash.slice(0, 10)}`,
          PmtMtd: "TRF",
          ReqdExctnDt: execDate,
          Dbtr: {
            Nm: "VeloRail Client Account",
          },
          DbtrAcct: {
            Id: {
              IBAN: "GB29VELO60161331926811",
            },
          },
          CdtTrfTxInf: {
            PmtId: {
              EndToEndId: txHash,
              TxId: `TX-${txHash.slice(0, 10)}`,
            },
            Amt: {
              InstdAmt: {
                _attributes: { Ccy: currencyVal },
                _text: amountVal.toString(),
              },
            },
            Cdtr: {
              Nm: recipientVal,
            },
            RmtInf: {
              Ustrd: referenceVal,
            },
          },
        },
      },
    },
  };
}

export async function settle(intent: TransactionIntent): Promise<{
  receipt: string;
  txRef: string;
  iso20022: object;
}> {
  if (intent.action !== "TRANSFER") {
    throw new Error(`On-chain settlement is not defined for action: ${intent.action}`);
  }

  const recipient = intent.recipient;
  const amount = intent.amount;
  const currency = intent.currency || "STT";

  if (!recipient || amount === null) {
    throw new Error("Cannot settle transaction: Missing recipient or amount.");
  }

  // Execute on-chain transaction
  const { txHash, gasCostEther } = await sendTransaction(recipient, amount);

  // Build ISO 20022 payload block
  const iso20022 = buildISO20022(intent, txHash);

  // Fee calculation (Traditional vs VeloRail Actual Gas Fee)
  const tradFee = 35.0 + amount * 0.005;
  const veloFee = parseFloat(gasCostEther);
  const savings = tradFee - veloFee;
  const savingsPct = (savings / tradFee) * 100;

  const actionName = "Transfer";
  const explorerUrl = `${process.env.BLOCK_EXPLORER_URL || "https://explorer-testnet.somnia.network/tx/"}${txHash}`;

  let receipt = `✅ *VeloRail — ${actionName} Confirmed*\n\n`;
  receipt += `📋 *Ref:* [${txHash.slice(0, 12)}...](${explorerUrl})\n`;
  receipt += `💸 *Amount:* ${amount} ${currency}\n`;
  receipt += `👤 *Recipient:* \`${recipient}\`\n`;
  if (intent.reference !== null) {
    receipt += `🏷 *Memo:* ${intent.reference}\n`;
  }

  receipt += `\n─────────────────────\n`;
  receipt += `📊 *Fee Analysis*\n`;
  receipt += `  Traditional wire:  ~$${tradFee.toFixed(2)}\n`;
  receipt += `  VeloRail (Gas):     $${veloFee.toFixed(6)} STT\n`;
  receipt += `  💰 *Saved:*          $${savings.toFixed(2)} (${savingsPct.toFixed(3)}% less)\n`;
  receipt += `─────────────────────\n`;

  receipt += `\n🕐 ${new Date().toUTCString()}\n`;
  receipt += `🔒 ISO 20022 pain.001.001.09`;

  return {
    receipt,
    txRef: txHash,
    iso20022,
  };
}
