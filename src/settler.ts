import crypto from "crypto";
import { TransactionIntent } from "./types";

function buildISO20022(intent: TransactionIntent, txRef: string) {
  const timestamp = new Date().toISOString();
  const execDate = timestamp.split("T")[0];
  const amountVal = intent.amount !== null ? intent.amount : 0;
  const currencyVal = intent.currency || "USD";
  const recipientVal = intent.recipient || "UNSPECIFIED";
  const referenceVal = intent.reference || "UNSPECIFIED";

  return {
    Document: {
      _attributes: {
        xmlns: "urn:iso:std:iso:20022:tech:xsd:pain.001.001.09",
      },
      CstmrCdtTrfInitn: {
        GrpHdr: {
          MsgId: txRef,
          CreDtTm: timestamp,
          NbOfTxs: "1",
          CtrlSum: amountVal.toString(),
          InitgPty: {
            Nm: "VeloRail Gateway",
          },
        },
        PmtInf: {
          PmtInfId: `PI-${txRef}`,
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
              EndToEndId: txRef,
              TxId: `TX-${txRef}`,
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
  // Generate reference: VR-{5 random hex bytes uppercase}-{timestamp base36 uppercase}
  const randomHex = crypto.randomBytes(5).toString("hex").toUpperCase();
  const base36Time = Date.now().toString(36).toUpperCase();
  const txRef = `VR-${randomHex}-${base36Time}`;

  // Build ISO 20022 payload block
  const iso20022 = buildISO20022(intent, txRef);

  // Fee calculation (Traditional vs VeloRail)
  let feeTable = "";
  if (intent.amount !== null) {
    const amount = intent.amount;
    const tradFee = 35.0 + amount * 0.005;
    const veloFee = 0.5 + amount * 0.001;
    const savings = tradFee - veloFee;
    const savingsPct = (savings / tradFee) * 100;

    feeTable = [
      `| Provider | Flat Fee | Variable Fee | Total Fee |`,
      `| :--- | :--- | :--- | :--- |`,
      `| Traditional Bank | $35.00 | 0.50% ($${(amount * 0.005).toFixed(2)}) | $${tradFee.toFixed(2)} |`,
      `| VeloRail Gateway | $0.50 | 0.10% ($${(amount * 0.001).toFixed(2)}) | $${veloFee.toFixed(2)} |`,
      `| Net Savings | | | $${savings.toFixed(2)} (${savingsPct.toFixed(1)}%) |`,
    ].join("\n");
  }

  // Header definition with zero unicode emojis to comply with strict instructions
  const header = `TRANSACTION SETTLED: ${intent.action}`;

  let receipt = `${header}\n`;
  receipt += `===\n`;
  receipt += `Reference: ${txRef}\n`;

  if (intent.amount !== null) {
    receipt += `Amount: ${intent.amount} ${intent.currency || "USD"}\n`;
  }
  if (intent.recipient !== null) {
    receipt += `Recipient: ${intent.recipient}\n`;
  }
  if (intent.reference !== null) {
    receipt += `Memo: ${intent.reference}\n`;
  }
  receipt += `Raw Input: ${intent.raw_input}\n`;

  if (feeTable) {
    receipt += `\nFee Comparison:\n${feeTable}\n`;
  }

  receipt += `\nTimestamp: ${new Date().toISOString()}\n`;
  receipt += `Schema: ISO 20022 (pain.001.001.09)`;

  return {
    receipt,
    txRef,
    iso20022,
  };
}
