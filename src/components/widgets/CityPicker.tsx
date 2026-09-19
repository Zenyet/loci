import { useEffect, useRef, useState } from 'react';
import type { WeatherCity } from '../../types';
import { searchCities } from '../../services/weather';
import { Icon } from '../Icon';

export function CityPicker({ onSelect }: { onSelect: (city: WeatherCity) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<WeatherCity[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const search = async () => {
    request.current?.abort();
    if (!query.trim()) return;
    const controller = new AbortController(); request.current = controller;
    setLoading(true); setError(null); setResults(null);
    try { const cities = await searchCities(query, controller.signal); if (!controller.signal.aborted) setResults(cities); }
    catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : '城市搜索失败，请重试。'); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  };
  return <div className="city-picker">
    <form className="city-picker__form" onSubmit={event => { event.preventDefault(); void search(); }}>
      <Icon name="search" size={16} />
      <input aria-label="城市名称" placeholder="搜索城市，例如上海" value={query} maxLength={80} onChange={event => {
        request.current?.abort(); setLoading(false); setResults(null); setError(null); setQuery(event.target.value);
      }} />
      <button type="submit" disabled={!query.trim() || loading}>{loading ? '查找中' : '查找'}</button>
    </form>
    <p className="widget-note">选择城市即可，无需定位。</p>
    {error && <p className="widget-error" role="alert">{error}</p>}
    <div className="city-picker__results" aria-live="polite">
      {results?.length === 0 && <p className="widget-note">没有找到这座城市，试试完整名称或拼音。</p>}
      {results?.map(city => <button type="button" key={city.id} onClick={() => { onSelect(city); setResults(null); setQuery(''); }}>
        <span><strong>{city.name}</strong><small>{[city.region, city.country].filter(Boolean).join(' · ')}</small></span><Icon name="plus" size={16} />
      </button>)}
    </div>
  </div>;
}
