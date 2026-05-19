export interface RetrieveResult {
  id: number;
  title: string;
  content: string;
  score: number;
}

export interface Retriever {
  retrieve(query: string, topK: number): Promise<RetrieveResult[]>;
}
