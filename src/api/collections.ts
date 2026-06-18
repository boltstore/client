import type { BoltstoreClient } from "../client";
import type { CollectionInfo } from "@boltstore/utils";

export function createCollectionsApi(client: BoltstoreClient) {
  return {
    list: async (): Promise<CollectionInfo[]> => {
      const res = await client.request<CollectionInfo[]>("GET", client.dbPath("/collections"));
      return res.data ?? [];
    },

    get: async (name: string): Promise<CollectionInfo> => {
      const res = await client.request<CollectionInfo>("GET", client.dbPath(`/collections/${name}`));
      return res.data!;
    },
  };
}
