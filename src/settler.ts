import { TransactionIntent } from "./types";
import { sendTransaction, getNameFromAddress } from "./evm";

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
  const amountInSTT = amount;
  const sourceCurrency = intent.originalCurrency || "STT";
  const sourceAmount = intent.originalAmount !== undefined && intent.originalAmount !== null ? intent.originalAmount : amount;
  
  // Traditional wire / cross-border transfer fee is approx $35.0 base + 0.5% in USD equivalent
  // VeloRail is just the gas cost on Somnia Testnet (1 STT = $1.00 USD mock)
  const amountInUSD = amountInSTT; 
  const tradFeeUSD = 35.0 + amountInUSD * 0.005;
  const veloFeeUSD = parseFloat(gasCostEther);
  const savingsUSD = tradFeeUSD - veloFeeUSD;
  const savingsPct = (savingsUSD / tradFeeUSD) * 100;

  // Format fees in source currency (e.g. Naira NGN)
  let tradFeeSourceStr = "";
  let veloFeeSourceStr = "";
  let savingsSourceStr = "";

  if (sourceCurrency === "NGN") {
    // 1 STT = 1 USD = 1500 NGN
    const tradFeeNGN = tradFeeUSD * 1500;
    const veloFeeNGN = veloFeeUSD * 1500;
    const savingsNGN = savingsUSD * 1500;

    tradFeeSourceStr = `₦${tradFeeNGN.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    veloFeeSourceStr = `₦${veloFeeNGN.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 })} (${gasCostEther} STT)`;
    savingsSourceStr = `₦${savingsNGN.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${savingsPct.toFixed(3)}% saved)`;
  } else if (sourceCurrency === "USD") {
    tradFeeSourceStr = `$${tradFeeUSD.toFixed(2)}`;
    veloFeeSourceStr = `$${veloFeeUSD.toFixed(6)} STT`;
    savingsSourceStr = `$${savingsUSD.toFixed(2)} (${savingsPct.toFixed(3)}% saved)`;
  } else {
    tradFeeSourceStr = `${tradFeeUSD.toFixed(2)} USD`;
    veloFeeSourceStr = `${veloFeeUSD.toFixed(6)} STT`;
    savingsSourceStr = `${savingsUSD.toFixed(2)} USD (${savingsPct.toFixed(3)}% saved)`;
  }

  const actionName = "Transfer";
  const explorerUrl = `${process.env.BLOCK_EXPLORER_URL || "https://explorer-testnet.somnia.network/tx/"}${txHash}`;
  
  const recipientName = getNameFromAddress(recipient);
  const recipientDisplay = recipientName ? `${recipientName} (\`${recipient}\`)` : `\`${recipient}\``;

  let receipt = `✅ *VeloRail — ${actionName} Confirmed*\n\n`;
  receipt += `📋 *Ref:* [${txHash.slice(0, 12)}...](${explorerUrl})\n`;
  
  if (intent.originalAmount !== undefined && intent.originalAmount !== null) {
    receipt += `💸 *Amount:* ${intent.originalAmount} ${sourceCurrency} (Settled as ${amount} STT)\n`;
  } else {
    receipt += `💸 *Amount:* ${amount} STT\n`;
  }
  
  receipt += `👤 *Recipient:* ${recipientDisplay}\n`;
  if (intent.reference !== null) {
    receipt += `🏷 *Memo:* ${intent.reference}\n`;
  }

  receipt += `\n─────────────────────\n`;
  receipt += `📊 *Fee Analysis (${sourceCurrency})*\n`;
  receipt += `  Traditional bank wire:  ~${tradFeeSourceStr}\n`;
  receipt += `  VeloRail (Somnia Gas):   ${veloFeeSourceStr}\n`;
  receipt += `  💰 *Saved:*              ${savingsSourceStr}\n`;
  receipt += `─────────────────────\n`;

  receipt += `\n🕐 ${new Date().toUTCString()}\n`;
  receipt += `🔒 ISO 20022 pain.001.001.09`;

  return {
    receipt,
    txRef: txHash,
    iso20022,
  };
}
