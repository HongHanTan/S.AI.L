# Rule Sources and Demo Boundary

## Indonesia import

- Published operational source:
  https://www.maersk.com/local-information/asia-pacific/indonesia/import
- Demo implementation:
  - local Indonesian consignee required;
  - consignee Tax ID / NPWP required;
  - rule runs for every carrier once destination country is Indonesia.

## Indonesia export

- Published operational source:
  https://www.maersk.com/~/media_sc9/maersk/local-information/files/asia-pacific/indonesia/export/export-advisory/shipping-instruction-mandatory.pdf
- Demo implementation:
  - local Indonesian shipper required;
  - shipper Tax ID required;
  - rule runs for every carrier once origin country is Indonesia.

## Boundary

The carrier pages above are retained as published operational evidence. The
application applies the Indonesia rule carrier-agnostically as an explicit
project requirement. Production rollout should have each rule reviewed by the
responsible documentation/compliance owner and versioned when requirements
change.
