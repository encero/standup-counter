import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { ConnectionManager } from '@/lib/ConnectionManager';

interface StockQuote {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  history: number[];
}

interface StockTickerProps {
  teamId: string;
  className?: string;
}

// Full-width stock chart component
function StockChart({ data, positive }: { data: number[]; positive: boolean }) {
  if (data.length < 2) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const height = 40;
  const padding = 2;

  const color = positive ? '#22c55e' : '#ef4444';

  const points = data.map((value, i) => {
    const x = padding + (i / (data.length - 1)) * (100 - padding * 2);
    const y = height - padding - ((value - min) / range) * (height - padding * 2);
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg viewBox={`0 0 100 ${height}`} className="w-full h-10" preserveAspectRatio="none">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function StockTicker({ teamId, className }: StockTickerProps) {
  const [quotes, setQuotes] = useState<StockQuote[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!teamId) return;

    const fetchQuotes = () => {
      ConnectionManager.get<{ quotes?: StockQuote[] }>(`/api/${teamId}/stocks`)
        .then(data => {
          setQuotes(data.quotes || []);
          setLoading(false);
        })
        .catch(() => setLoading(false));
    };

    fetchQuotes();
    // Refresh every 60 seconds
    const interval = setInterval(fetchQuotes, 60000);
    return () => clearInterval(interval);
  }, [teamId]);

  if (loading) {
    return null;
  }

  if (quotes.length === 0) {
    return (
      <div className={cn("text-center py-2 text-xs text-muted-foreground", className)}>
        No stock configured. Add a symbol in Settings.
      </div>
    );
  }

  // Only show the first symbol
  const quote = quotes[0];

  // Calculate 30-day change from history
  const hasHistory = quote.history && quote.history.length > 1;
  const startPrice = hasHistory ? quote.history[0] : quote.price;
  const endPrice = hasHistory ? quote.history[quote.history.length - 1] : quote.price;
  const intervalChange = endPrice - startPrice;
  const intervalChangePercent = startPrice > 0 ? (intervalChange / startPrice) * 100 : 0;
  const isPositive = intervalChange >= 0;

  return (
    <div className={cn("w-full", className)}>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-baseline gap-1.5">
          <span className="font-semibold">{quote.symbol}</span>
          <span className="text-xs text-muted-foreground truncate max-w-[120px]">{quote.name}</span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="font-mono">${quote.price.toFixed(2)}</span>
          <span className={cn(
            "text-xs font-mono",
            isPositive ? "text-green-600" : "text-red-600"
          )}>
            {isPositive ? '▲' : '▼'}{Math.abs(intervalChangePercent).toFixed(1)}%
          </span>
        </div>
      </div>
      {hasHistory && (
        <div className="w-full bg-muted/20 rounded p-1.5">
          <StockChart data={quote.history} positive={isPositive} />
          <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
            <span>${startPrice.toFixed(2)}</span>
            <span>30d</span>
            <span>${endPrice.toFixed(2)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
