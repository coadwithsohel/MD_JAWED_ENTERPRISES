export async function withRetryRead<T>(
  operation: () => Promise<T>,
  maxRetries: number = 2
): Promise<T> {
  let attempt = 0;
  while (attempt <= maxRetries) {
    try {
      return await operation();
    } catch (error: any) {
      // Check if it's a Prisma connection error or specifically SQLSTATE 57P01
      const isConnectionError =
        error?.code === "P2010" || // Raw query failed
        error?.code === "P2024" || // Timed out fetching a new connection from the pool
        error?.code === "P2028" || // Transaction API error
        error?.message?.includes("57P01") ||
        error?.message?.includes("terminating connection due to administrator command") ||
        error?.message?.includes("Connection pool is full");

      if (!isConnectionError || attempt >= maxRetries) {
        throw error;
      }

      attempt++;
      // Exponential backoff: 500ms, 1000ms, ...
      const delay = Math.pow(2, attempt - 1) * 500;
      console.warn(`[db-retry] Database read error (attempt ${attempt}/${maxRetries}). Retrying in ${delay}ms...`, error?.message || error);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error("Maximum retries reached for database read operation.");
}
