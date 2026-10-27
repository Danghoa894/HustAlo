// Khai báo tối thiểu cho API có sẵn ở cả Node 22 và trình duyệt. Shared không bật lib DOM hay @types/node
// (không được phụ thuộc môi trường, kiến trúc §4.3). File này không được import → không ảnh hưởng client/server.
declare class TextEncoder {
  encode(input?: string): Uint8Array;
}
declare class TextDecoder {
  constructor(label?: string, options?: { fatal?: boolean });
  decode(input?: Uint8Array): string;
}
