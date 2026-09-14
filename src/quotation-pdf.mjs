const { jsPDF } = window.jspdf || {};
const COLORS = {
    white: '#ffffff',
    navy: '#102a3a',
    teal: '#00aFA5',
    pale: '#ddf7f4',
    row: '#f3fbfa',
    line: '#b9e8e3',
    slate: '#405766',
    muted: '#8295a6',
    grid: '#294655',
    faint: '#dbe7ec',
    canvas: '#fbfefd',
};
const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const TABLE_LEFT = 54;
const TABLE_RIGHT = 583;
const TABLE_TOP = 264;
const TABLE_BOTTOM = 530;
const ROW_HEIGHT = 30;
const ITEMS_PER_PAGE = 8;
function bytesToBase64(bytes) {
    let binary = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return btoa(binary);
}
async function assetData(path, mimeType) {
    const response = await fetch(path);
    if (!response.ok)
        throw new Error(`Could not load PDF asset: ${path}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    return `data:${mimeType};base64,${bytesToBase64(bytes)}`;
}
async function registerFonts(doc) {
    const fonts = [
        { path: '/fonts/Roboto-Regular.ttf', file: 'Roboto-Regular.ttf', family: 'Roboto', style: 'normal' },
        { path: '/fonts/Roboto-Bold.ttf', file: 'Roboto-Bold.ttf', family: 'Roboto', style: 'bold' },
        { path: '/fonts/Roboto-Black.ttf', file: 'Roboto-Black.ttf', family: 'RobotoBlack', style: 'normal' },
        { path: '/fonts/Roboto-Italic.ttf', file: 'Roboto-Italic.ttf', family: 'Roboto', style: 'italic' },
        { path: '/fonts/DroidSansMono.ttf', file: 'DroidSansMono.ttf', family: 'DroidSansMono', style: 'normal' },
    ];
    const data = await Promise.all(fonts.map((font) => assetData(font.path, 'font/ttf')));
    fonts.forEach((font, index) => {
        doc.addFileToVFS(font.file, data[index].slice(data[index].indexOf(',') + 1));
        doc.addFont(font.file, font.family, font.style);
    });
}
function formatNumber(value) {
    const rounded = Math.round(value * 100) / 100;
    const hasDecimals = Math.abs(rounded - Math.round(rounded)) > 0.001;
    return new Intl.NumberFormat('en-IN', {
        minimumFractionDigits: hasDecimals ? 2 : 0,
        maximumFractionDigits: hasDecimals ? 2 : 0,
    }).format(rounded);
}
function formatMoney(value) {
    return `₹${formatNumber(value)}`;
}
function setFont(doc, family, style = 'normal', size = 8) {
    doc.setFont(family, style);
    doc.setFontSize(size);
}
function fitText(doc, text, x, y, maxWidth, startSize, minSize, options) {
    let size = startSize;
    doc.setFontSize(size);
    const spacedWidth = () => doc.getTextWidth(text) + Math.max(text.length - 1, 0) * (options?.charSpace ?? 0);
    while (size > minSize && spacedWidth() > maxWidth) {
        size -= 0.25;
        doc.setFontSize(size);
    }
    doc.setTextColor(options?.color ?? COLORS.navy);
    doc.text(text, x, y, { align: options?.align ?? 'left', charSpace: options?.charSpace ?? 0 });
}
function drawMoneyRight(doc, value, right, y, size, color) {
    const digits = formatNumber(value);
    setFont(doc, 'DroidSansMono', 'normal', size);
    doc.setTextColor(color);
    doc.text(digits, right, y, { align: 'right' });
    const digitsWidth = doc.getTextWidth(digits);
    setFont(doc, 'Roboto', 'bold', size);
    doc.text('₹', right - digitsWidth - 4, y, { align: 'right' });
}
function drawPageChrome(doc) {
    doc.setFillColor(COLORS.white);
    doc.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, 'F');
    doc.setFillColor(COLORS.pale);
    doc.rect(0, 0, 38, PAGE_HEIGHT, 'F');
    doc.setDrawColor(COLORS.line);
    doc.setLineWidth(0.55);
    doc.line(38, 0, 38, PAGE_HEIGHT);
    doc.line(19, 36, 19, 806);
    doc.setFillColor(COLORS.teal);
    doc.circle(19, 26, 5, 'F');
    doc.circle(19, 820, 5, 'F');
}
function drawHeader(doc, quotation, logo) {
    setFont(doc, 'Roboto', 'bold', 8);
    doc.setTextColor(COLORS.teal);
    doc.text('COMMERCIAL QUOTATION', 54, 35, { charSpace: 2.4 });
    setFont(doc, 'RobotoBlack', 'normal', 27);
    doc.setTextColor(COLORS.navy);
    doc.text('RX Design Hub', 54, 56);
    setFont(doc, 'Roboto', 'normal', 8);
    doc.setTextColor(COLORS.muted);
    doc.text('PHARMA BRANDING  ·  VIKAS NAGAR, LUCKNOW', 54, 71.5);
    setFont(doc, 'DroidSansMono', 'normal', 7.5);
    doc.text('GSTIN: 09HELPK6138H1ZO  ·  +91 9219548031', 54, 84.5);
    if (logo) {
        doc.addImage(logo, 'PNG', 473.42, 18, 75.16, 56, undefined, 'FAST');
    }
    else {
        setFont(doc, 'RobotoBlack', 'normal', 24);
        doc.setTextColor(COLORS.teal);
        doc.text('RX', 548, 55, { align: 'right' });
    }
    doc.setDrawColor(COLORS.pale);
    doc.setLineWidth(1.2);
    doc.line(50, 104, 583, 104);
    doc.line(50, 142, 583, 142);
    const issued = new Date(quotation.createdAt);
    const valid = new Date(issued);
    valid.setDate(valid.getDate() + 15);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const date = (value) => `${String(value.getDate()).padStart(2, '0')} ${months[value.getMonth()]} ${value.getFullYear()}`;
    const meta = [
        ['QUOTATION NO', quotation.quotationId],
        ['DATE ISSUED', date(issued)],
        ['VALID TILL', date(valid)],
        ['PREPARED BY', quotation.preparedBy],
        ['CONTACT', '9219548031'],
    ];
    const dividers = [160.6, 267.2, 373.8, 480.4];
    const columns = [54, 168.6, 275.2, 381.8, 488.4];
    const columnWidths = [98, 90, 90, 90, 88];
    dividers.forEach((x) => {
        doc.setDrawColor(COLORS.pale);
        doc.setLineWidth(0.7);
        doc.line(x, 110, x, 136);
    });
    meta.forEach(([label, value], index) => {
        setFont(doc, 'Roboto', 'bold', 6.8);
        doc.setTextColor(COLORS.muted);
        doc.text(label, columns[index], 118, { charSpace: 0.35 });
        setFont(doc, 'Roboto', 'bold', 11);
        const valueSize = index === 0 ? 10.6 : index === 1 || index === 2 ? 10.65 : index === 4 ? 10.5 : 11;
        fitText(doc, String(value), columns[index], 134, columnWidths[index], valueSize, 8, {
            color: index === 0 ? COLORS.teal : COLORS.navy,
            charSpace: 0.05,
        });
    });
}
function drawSectionHeading(doc, label, y, lineStart) {
    doc.setFillColor(COLORS.teal);
    doc.rect(54, y - 1, 16, 3, 'F');
    setFont(doc, 'Roboto', 'bold', 8);
    doc.setTextColor(COLORS.navy);
    doc.text(label, 76.4, y + 2.2, { charSpace: 0.45 });
    doc.setDrawColor(COLORS.pale);
    doc.setLineWidth(1.2);
    doc.line(lineStart, y, 583, y);
}
function drawClientDetails(doc, quotation) {
    drawSectionHeading(doc, 'CLIENT DETAILS', 167, 155);
    doc.setFillColor(COLORS.canvas);
    doc.setDrawColor(COLORS.line);
    doc.setLineWidth(0.65);
    doc.roundedRect(54, 174, 529, 60, 3, 3, 'FD');
    doc.line(307.5, 174, 307.5, 234);
    doc.line(54, 204, 583, 204);
    const fields = [
        { label: 'COMPANY NAME', value: quotation.companyName, x: 62.4, labelY: 187.5, valueY: 200, width: 232, accent: true },
        { label: 'CONTACT NUMBER', value: quotation.phone || '-', x: 316, labelY: 187.5, valueY: 200, width: 250 },
        { label: 'CITY', value: quotation.city || '-', x: 62.4, labelY: 217.5, valueY: 230, width: 232 },
        { label: 'ACCOUNT EXECUTIVE', value: `${quotation.preparedBy} · RX Design Hub`, x: 316, labelY: 217.5, valueY: 230, width: 250 },
    ];
    fields.forEach((field) => {
        setFont(doc, 'Roboto', 'bold', 6.8);
        doc.setTextColor(COLORS.muted);
        doc.text(field.label, field.x, field.labelY, { charSpace: 0.35 });
        setFont(doc, 'Roboto', 'bold', 11);
        fitText(doc, field.value, field.x, field.valueY, field.width, 11, 8, {
            color: field.accent ? COLORS.teal : COLORS.navy,
            charSpace: 0.08,
        });
    });
}
function itemDescription(item) {
    return `${item.product} - ${item.variety}`;
}
function drawOrderTable(doc, items, pageNumber, totalPages) {
    drawSectionHeading(doc, pageNumber === 1 ? 'ORDER PARTICULARS' : `ORDER PARTICULARS · PAGE ${pageNumber}/${totalPages}`, 257, 176);
    doc.setDrawColor(COLORS.line);
    doc.setLineWidth(0.6);
    doc.rect(TABLE_LEFT, TABLE_TOP, TABLE_RIGHT - TABLE_LEFT, TABLE_BOTTOM - TABLE_TOP);
    doc.setFillColor(COLORS.navy);
    doc.rect(TABLE_LEFT, TABLE_TOP, TABLE_RIGHT - TABLE_LEFT, 26, 'F');
    for (let row = 0; row < ITEMS_PER_PAGE; row += 1) {
        const top = 290 + row * ROW_HEIGHT;
        doc.setFillColor(row % 2 === 0 ? COLORS.row : COLORS.white);
        doc.rect(55, top, 527, ROW_HEIGHT, 'F');
        doc.setDrawColor(COLORS.pale);
        doc.line(TABLE_LEFT, top, TABLE_RIGHT, top);
    }
    doc.line(TABLE_LEFT, TABLE_BOTTOM, TABLE_RIGHT, TABLE_BOTTOM);
    [342, 388, 454].forEach((x) => {
        doc.setDrawColor(COLORS.line);
        doc.setLineWidth(0.65);
        doc.line(x, TABLE_TOP, x, TABLE_BOTTOM);
    });
    [342, 388, 454].forEach((x) => {
        doc.setDrawColor(COLORS.grid);
        doc.setLineWidth(0.55);
        doc.line(x, TABLE_TOP, x, 290);
    });
    setFont(doc, 'Roboto', 'bold', 7.5);
    doc.setTextColor('#80cbc4');
    doc.text('#', 67, 281.3, { align: 'center' });
    doc.text('PRODUCT DESCRIPTION', 84.35, 281.3, { charSpace: 0.3 });
    doc.text('QTY', 365, 281.3, { align: 'center', charSpace: 0.3 });
    doc.text('UNIT RATE', 421, 281.3, { align: 'center', charSpace: 0.3 });
    doc.text('AMOUNT', 505, 281.3, { align: 'center', charSpace: 0.3 });
    for (let row = 0; row < ITEMS_PER_PAGE; row += 1) {
        const item = items[row];
        const baseline = 311 + row * ROW_HEIGHT;
        setFont(doc, 'Roboto', 'normal', 8.25);
        doc.setTextColor(item ? COLORS.muted : COLORS.faint);
        doc.text(String((pageNumber - 1) * ITEMS_PER_PAGE + row + 1).padStart(2, '0'), 61.45, baseline);
        if (!item)
            continue;
        setFont(doc, 'Roboto', 'bold', 9.15);
        fitText(doc, itemDescription(item), 88.45, baseline, 244, 9.15, 7.25, {
            color: COLORS.navy,
            charSpace: 0.06,
        });
        setFont(doc, 'Roboto', 'normal', 9);
        doc.setTextColor(COLORS.slate);
        doc.text(formatNumber(item.quantity), 365, baseline, { align: 'center' });
        doc.text(formatMoney(item.rate), 449.5, baseline, { align: 'right' });
        setFont(doc, 'Roboto', 'bold', 9.15);
        doc.setTextColor(COLORS.teal);
        doc.text(formatMoney(item.quantity * item.rate), 538.5, baseline, { align: 'right' });
    }
}
function drawSummary(doc, quotation) {
    const rows = quotation.discount > 0
        ? [
            { label: 'Subtotal', value: quotation.subtotal, height: 18 },
            { label: 'Discount', value: -quotation.discount, height: 18 },
            { label: 'GST @18%', value: quotation.gst, height: 18 },
        ]
        : [
            { label: 'Subtotal', value: quotation.subtotal, height: 22 },
            { label: 'GST @18%', value: quotation.gst, height: 22 },
        ];
    const left = 354;
    const width = 229;
    let y = 530;
    doc.setDrawColor(COLORS.line);
    doc.setLineWidth(0.6);
    doc.line(left, y, left, y + rows.reduce((sum, row) => sum + row.height, 0) + 32);
    rows.forEach((row, index) => {
        doc.setFillColor(index % 2 === 0 ? COLORS.row : COLORS.white);
        doc.rect(left, y, width, row.height, 'F');
        doc.setDrawColor(index % 2 === 0 ? COLORS.line : COLORS.pale);
        doc.line(left, y, left + width, y);
        setFont(doc, 'Roboto', 'normal', 9);
        doc.setTextColor(COLORS.slate);
        doc.text(row.label, 362.45, y + row.height / 2 + 3.2);
        if (row.value < 0) {
            setFont(doc, 'Roboto', 'bold', 9);
            doc.setTextColor(COLORS.navy);
            doc.text(`- ${formatMoney(Math.abs(row.value))}`, 578.3, y + row.height / 2 + 3.2, { align: 'right' });
        }
        else {
            drawMoneyRight(doc, row.value, 578.3, y + row.height / 2 + 3.2, 9, COLORS.navy);
        }
        y += row.height;
    });
    doc.setFillColor(COLORS.navy);
    doc.rect(left, y, width, 32, 'F');
    setFont(doc, 'Roboto', 'bold', 10);
    doc.setTextColor('#80cbc4');
    doc.text('GRAND TOTAL', 362.5, y + 20, { charSpace: 0.65 });
    drawMoneyRight(doc, quotation.total, 579.7, y + 20, 11, '#00e5d8');
}
function drawFooter(doc, quotation, qr) {
    doc.setDrawColor(COLORS.pale);
    doc.setLineWidth(1.2);
    doc.line(54, 626, 583, 626);
    setFont(doc, 'Roboto', 'bold', 8);
    doc.setTextColor(COLORS.navy);
    doc.text('BANK DETAILS', 54.4, 639, { charSpace: 0.4 });
    doc.text('TERMS & CONDITIONS', 280.4, 639, { charSpace: 0.4 });
    doc.setTextColor(COLORS.muted);
    doc.setFontSize(7);
    doc.text('SCAN & PAY', 444.35, 639, { charSpace: 0.8 });
    doc.setDrawColor(COLORS.teal);
    doc.setLineWidth(2.4);
    doc.line(54, 642, 138, 642);
    doc.setDrawColor(COLORS.line);
    doc.line(280, 642, 338, 642);
    const bankRows = [
        ['Bank Name', 'Kotak Mahindra Bank'],
        ['Account Name', 'RX DESIGN HUB'],
        ['Account No.', '5949316762'],
        ['IFSC Code', 'KKBK0005206'],
        ['UPI ID', 'rxdesignhub@kotak'],
        ['Branch', 'Vikas Nagar, Lucknow'],
    ];
    bankRows.forEach(([label, value], index) => {
        const y = 658 + index * 14;
        setFont(doc, 'Roboto', 'normal', 8);
        doc.setTextColor(COLORS.muted);
        doc.text(label, 54.4, y);
        setFont(doc, 'DroidSansMono', 'normal', 8.5);
        doc.text(':', 132.4, y);
        fitText(doc, value, 144, y, 125, 8.5, 7, {
            color: value === 'rxdesignhub@kotak' ? COLORS.teal : COLORS.navy,
            charSpace: 0.08,
        });
    });
    const terms = [
        ['1. Production starts only', 658],
        ['after 50% advance payment.', 670],
        ['2. Dispatch subject to', 688],
        ['clearance of outstanding', 700],
        ['dues.', 712],
        ['3. Freight & courier charges', 730],
        ['borne by client.', 742],
    ];
    setFont(doc, 'Roboto', 'normal', 8);
    doc.setTextColor(COLORS.slate);
    terms.forEach(([line, y]) => doc.text(line, 280.4, y));
    doc.setDrawColor(COLORS.muted);
    doc.setLineWidth(0.7);
    doc.line(280, 768, 418, 768);
    setFont(doc, 'Roboto', 'normal', 7.5);
    doc.setTextColor(COLORS.muted);
    doc.text('Authorised Signatory · RX Design Hub', 280.35, 779, { charSpace: 0.05 });
    doc.setFillColor(COLORS.row);
    doc.roundedRect(444, 646, 96, 76, 3, 3, 'F');
    doc.setDrawColor(COLORS.line);
    doc.roundedRect(444, 646, 96, 76, 3, 3);
    if (qr)
        doc.addImage(qr, 'PNG', 456.68, 650, 70.65, 68, undefined, 'FAST');
    setFont(doc, 'DroidSansMono', 'normal', 6.5);
    doc.setTextColor(COLORS.teal);
    doc.text('rxdesignhub@kotak', 491.55, 735, { align: 'center' });
    drawBottomReference(doc, quotation, false);
}
function drawBottomReference(doc, quotation, continued) {
    doc.setDrawColor(COLORS.pale);
    doc.setLineWidth(1);
    doc.line(0, 820, PAGE_WIDTH, 820);
    setFont(doc, 'Roboto', 'italic', 8.5);
    doc.setTextColor(COLORS.muted);
    doc.text(continued ? 'Quotation continued on the next page.' : "Thank you for choosing RX Design Hub · India's trusted pharma branding partner.", 54.4, 833, { charSpace: 0.05 });
    setFont(doc, 'DroidSansMono', 'normal', 7);
    doc.setTextColor(COLORS.line);
    doc.text(`REF · ${quotation.quotationId} · ${continued ? 'CONTINUED' : 'CONFIDENTIAL'}`, 580, 833, { align: 'right', charSpace: 0.2 });
}
export async function createQuotationPdf(quotation) {
    const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true, putOnlyUsedFonts: true });
    await registerFonts(doc);
    const [logo, qr] = await Promise.all([
        assetData('/rx-wordmark.png', 'image/png').catch(() => undefined),
        assetData('/qr-code.png', 'image/png').catch(() => undefined),
    ]);
    const itemPages = [];
    for (let index = 0; index < Math.max(quotation.items.length, 1); index += ITEMS_PER_PAGE) {
        itemPages.push(quotation.items.slice(index, index + ITEMS_PER_PAGE));
    }
    itemPages.forEach((items, index) => {
        if (index > 0)
            doc.addPage('a4', 'portrait');
        drawPageChrome(doc);
        drawHeader(doc, quotation, logo);
        drawClientDetails(doc, quotation);
        drawOrderTable(doc, items, index + 1, itemPages.length);
        const isLastPage = index === itemPages.length - 1;
        if (isLastPage) {
            drawSummary(doc, quotation);
            drawFooter(doc, quotation, qr);
        }
        else {
            drawBottomReference(doc, quotation, true);
        }
    });
    return doc;
}
export async function downloadQuotationPdf(quotation) {
    const doc = await createQuotationPdf(quotation);
    doc.save(`${quotation.quotationId}.pdf`);
}
export async function shareQuotationPdf(quotation) {
    const doc = await createQuotationPdf(quotation);
    const blob = doc.output('blob');
    const file = new File([blob], `${quotation.quotationId}.pdf`, { type: 'application/pdf' });
    const shareData = { title: `Quotation ${quotation.quotationId}`, text: `Quotation for ${quotation.companyName}\nQuotation ID: ${quotation.quotationId}`, files: [file] };
    if (navigator.share && navigator.canShare?.(shareData)) {
        await navigator.share(shareData);
        return 'shared';
    }
    doc.save(file.name);
    window.open(`https://wa.me/${quotation.phone.replace(/\D/g, '')}?text=${encodeURIComponent(shareData.text + '\nPDF has been downloaded on your device.')}`, '_blank', 'noopener,noreferrer');
    return 'downloaded';
}

