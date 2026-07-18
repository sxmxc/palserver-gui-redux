declare module "selfsigned" {
  interface Pems {
    private: string;
    public: string;
    cert: string;
  }
  export function generate(
    attrs?: Array<{ name: string; value: string }>,
    opts?: Record<string, unknown>,
  ): Promise<Pems>;
  const _default: { generate: typeof generate };
  export default _default;
}
