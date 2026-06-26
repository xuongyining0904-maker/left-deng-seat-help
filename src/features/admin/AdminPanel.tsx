'use client';

import { useEffect, useState } from 'react';
import type { AppUser, ProofField, ProofFieldType, Seat, ZoneConfig } from '@/lib/types';
import type { ProofAnswers } from '@/lib/proof';
import { proofFieldTypeLabel, splitOptions } from '@/lib/proof';
import { isSeatTaken, isSeatValid, rowSeatCount, seatKey } from '@/lib/visibility';
import { Tabs } from '@/components/ui';
import { tiers } from '@/lib/mock-data';
import { addProofFieldToApi, approveUser, createZoneInApi, deactivateUser, deleteProofFieldFromApi, deleteZoneInApi, fetchAdminSeatMap, fetchAdminStats, rejectUser, saveAdminSeatToApi, updateZoneInApi } from '@/lib/api/client';

type AdminTab = 'audit' | 'users' | 'stats' | 'seatmap' | 'config' | 'proof';
type ProofSubmission = { userId: string; answers: ProofAnswers };

type Props = {
  users: AppUser[];
  setUsers: (updater: (users: AppUser[]) => AppUser[]) => void;
  submissions: ProofSubmission[];
  proofFields: ProofField[];
  setProofFields: (updater: (fields: ProofField[]) => ProofField[]) => void;
  zoneConfigs: ZoneConfig[];
  setZoneConfigs: (updater: (configs: ZoneConfig[]) => ZoneConfig[]) => void;
};

export function AdminPanel(props: Props) {
  const [tab, setTab] = useState<AdminTab>('audit');
  const [selectedZone, setSelectedZone] = useState('101区');
  return <section className="panel"><div className="head"><h3>管理后台</h3></div><div className="body table"><Tabs<AdminTab> value={tab} onChange={setTab} options={[{ value: 'audit', label: '用户审核' }, { value: 'users', label: '用户管理' }, { value: 'stats', label: '统计' }, { value: 'seatmap', label: '座位示意图' }, { value: 'config', label: '场馆配置' }, { value: 'proof', label: '自证配置' }]} />{tab === 'audit' ? <AuditAdmin {...props} /> : tab === 'users' ? <UsersAdmin {...props} /> : tab === 'stats' ? <StatsAdmin users={props.users} /> : tab === 'seatmap' ? <SeatMapAdmin {...props} selectedZone={selectedZone} setSelectedZone={setSelectedZone} /> : tab === 'config' ? <ConfigAdmin {...props} /> : <ProofAdmin proofFields={props.proofFields} setProofFields={props.setProofFields} />}</div></section>;
}

function AuditAdmin({ users, setUsers, submissions, proofFields }: Props) {
  const list = users.filter((user) => user.status === 'pending' || user.status === 'rejected');
  async function reject(user: AppUser) {
    const reason = window.prompt('请输入打回原因，用户会按这个原因重新修改自证：', user.rejectReason ?? '');
    if (!reason?.trim()) return;
    try {
      await rejectUser(user.id, reason.trim());
      setUsers((prev) => prev.map((item) => item.id === user.id ? { ...item, status: 'rejected', rejectReason: reason.trim() } : item));
    } catch (error) {
      alert(error instanceof Error ? error.message : '打回失败');
    }
  }
  async function approve(user: AppUser) {
    try {
      await approveUser(user.id);
      setUsers((prev) => prev.map((item) => item.id === user.id ? { ...item, status: 'approved', rejectReason: '' } : item));
    } catch (error) {
      alert(error instanceof Error ? error.message : '通过失败');
    }
  }
  async function deactivate(user: AppUser) {
    try {
      await deactivateUser(user.id);
      setUsers((prev) => prev.filter((item) => item.id !== user.id));
    } catch (error) {
      alert(error instanceof Error ? error.message : '注销失败');
    }
  }
  return <div className="table">{list.length ? list.map((user) => { const submission = submissions.find((item) => item.userId === user.id); return <div className={'row ' + (user.status === 'rejected' ? 'danger' : '')} key={user.id}><div><strong>{user.account} · {user.weiboName}</strong><small>微信名：{user.wechatName} · 线下群：{user.offlineGroup}</small>{user.rejectReason ? <p>打回原因：{user.rejectReason}</p> : null}{submission ? <ProofAnswers fields={proofFields} submission={submission} /> : <p className="muted">暂无提交内容</p>}</div><small>状态：{user.status}</small><div className="stack"><button className="btn" onClick={() => approve(user)}>通过</button><button className="btn danger" onClick={() => reject(user)}>打回</button><button className="btn warning" onClick={() => deactivate(user)}>注销</button></div></div>; }) : <div className="status">暂无待审核用户。</div>}</div>;
}

function ProofAnswers({ fields, submission }: { fields: ProofField[]; submission: ProofSubmission }) {
  return <div className="proofs">{fields.map((field) => { const value = submission.answers[field.id]; if (!value) return <div className="proof" key={field.id}>{field.label}：未提交</div>; if (typeof value === 'object' && !Array.isArray(value) && 'url' in value) return <div className="proof" key={field.id}><img src={value.url} alt={field.label} /><span>{field.label} · {value.name}</span></div>; return <div className="proof" key={field.id}>{field.label}：{Array.isArray(value) ? value.join('、') : String(value)}</div>; })}</div>;
}

function UsersAdmin({ users, setUsers, zoneConfigs }: Props) {
  const list = users.filter((user) => user.role !== 'admin' && user.status !== 'deactivated');
  async function saveAdminSeat(user: AppUser, form: FormData) {
    const seat: Seat = { tier: String(form.get('tier')), zone: String(form.get('zone')), row: Number(form.get('row')), no: Number(form.get('no')) };
    if (!isSeatValid(zoneConfigs, seat)) return alert('这个座位不在该区配置内');
    if (isSeatTaken(users, seat, user.id)) return alert('这个座位已经有人登记');
    try {
      await saveAdminSeatToApi(user.id, seat);
      setUsers((prev) => prev.map((item) => item.id === user.id ? { ...item, seat } : item));
    } catch (error) {
      alert(error instanceof Error ? error.message : '保存座位失败');
    }
  }
  return <div className="table">{list.map((user) => <div className="row" key={user.id}><div><strong>{user.account} · {user.weiboName || '未填微博名'}</strong><small>{user.status} · {user.seat ? seatKey(user.seat) : '未登记座位'}</small><form className="mini-form" onSubmit={(event) => { event.preventDefault(); saveAdminSeat(user, new FormData(event.currentTarget)); }}><input name="tier" defaultValue={user.seat?.tier ?? '一层看台'} /><input name="zone" defaultValue={user.seat?.zone ?? '101区'} /><input name="row" defaultValue={user.seat?.row ?? 1} /><input name="no" defaultValue={user.seat?.no ?? 1} /><button className="btn secondary">保存座位</button></form></div><small>微信名：{user.wechatName}<br />线下群：{user.offlineGroup}</small><div className="stack"><button className="btn warning" onClick={async () => { try { await deactivateUser(user.id); setUsers((prev) => prev.filter((item) => item.id !== user.id)); } catch (error) { alert(error instanceof Error ? error.message : '注销失败'); } }}>注销</button><button className="btn secondary" onClick={async () => { try { await approveUser(user.id); setUsers((prev) => prev.map((item) => item.id === user.id ? { ...item, status: 'approved' } : item)); } catch (error) { alert(error instanceof Error ? error.message : '恢复失败'); } }}>恢复通过</button></div></div>)}</div>;
}

function StatsAdmin({ users }: { users: AppUser[] }) {
  const [stats, setStats] = useState<{ totalUsers: number; approved: number; pending: number; rejected: number; deactivated: number; seated: number; byZone: Record<string, number> } | null>(null);
  useEffect(() => {
    fetchAdminStats().then(setStats).catch((error) => alert(error instanceof Error ? error.message : '加载统计失败'));
  }, [users.length]);
  if (!stats) return <div className="status">正在加载统计...</div>;
  return <div className="table"><div className="stat-grid"><div className="status">总用户：{stats.totalUsers}</div><div className="status">审核通过：{stats.approved}</div><div className="status">已登记：{stats.seated}</div><div className="status">待审核：{stats.pending}</div><div className="status">打回：{stats.rejected}</div><div className="status">已注销：{stats.deactivated}</div></div>{Object.entries(stats.byZone).map(([zone, count]) => <div className="row" key={zone}><strong>{zone}</strong><small>{count} 人</small><span /></div>)}</div>;
}

function SeatMapAdmin({ zoneConfigs, selectedZone, setSelectedZone }: Props & { selectedZone: string; setSelectedZone: (zone: string) => void }) {
  const fallback = zoneConfigs.find((item) => item.zone === selectedZone) ?? zoneConfigs[0];
  const [map, setMap] = useState<{ zone: ZoneConfig; seats: { row: number; no: number; message: string; user: { weibo_name?: string | null; wechat_name?: string | null; account?: string } | null }[] } | null>(null);
  useEffect(() => {
    if (!fallback?.zone) return;
    fetchAdminSeatMap(fallback.zone).then(setMap).catch((error) => alert(error instanceof Error ? error.message : '加载座位图失败'));
  }, [fallback?.zone]);
  const config = map?.zone ?? fallback;
  const seats = map?.seats ?? [];
  return <div className="table"><label className="field">选择区域<select value={config.zone} onChange={(event) => setSelectedZone(event.target.value)}>{zoneConfigs.map((item) => <option key={item.zone}>{item.zone}</option>)}</select></label><div className="status"><strong>{config.zone} · 已登记 {seats.length} 人</strong></div>{config.rowCounts.map((count, rowIndex) => <div key={rowIndex}><p className="muted">{rowIndex + 1}排</p><div className="admin-seats">{Array.from({ length: count }, (_, noIndex) => { const no = noIndex + 1; const owner = seats.find((seat) => seat.row === rowIndex + 1 && seat.no === no); return <div key={no} title={owner?.user?.weibo_name || owner?.user?.account || ''} className={'seat ' + (owner ? 'taken' : '')} />; })}</div></div>)}</div>;
}

function ConfigAdmin({ zoneConfigs, setZoneConfigs }: Props) {
  function parseRowCounts(form: FormData) {
    const custom = String(form.get('rowCounts') ?? '').trim();
    if (custom) {
      const counts = custom.split(/[,，\s]+/).map(Number).filter((item) => Number.isFinite(item) && item > 0);
      if (counts.length) return counts;
    }
    const rows = Math.max(1, Number(form.get('rows')));
    const max = Math.max(1, Number(form.get('max')));
    return Array.from({ length: rows }, () => max);
  }

  async function saveConfig(zone: string, form: FormData) {
    const name = String(form.get('zone')).trim();
    const tier = String(form.get('tier'));
    const next = { tier, zone: name || zone, rowCounts: parseRowCounts(form) };
    try {
      await updateZoneInApi(zone, next);
      setZoneConfigs((prev) => prev.map((item) => item.zone === zone ? next : item));
    } catch (error) {
      alert(error instanceof Error ? error.message : '保存区域失败');
    }
  }

  async function addZone(form: FormData) {
    const zone = String(form.get('zone')).trim();
    const tier = String(form.get('tier'));
    if (!zone) return alert('请填写区域名');
    const next = { tier, zone, rowCounts: parseRowCounts(form) };
    try {
      await createZoneInApi(next);
      setZoneConfigs((prev) => [...prev, next].sort((a, b) => a.zone.localeCompare(b.zone, 'zh-Hans-CN', { numeric: true })));
    } catch (error) {
      alert(error instanceof Error ? error.message : '新增区域失败');
    }
  }

  async function removeZone(zone: string) {
    if (!confirm('确定删除 ' + zone + ' 吗？已经有人登记的区不能删除。')) return;
    try {
      await deleteZoneInApi(zone);
      setZoneConfigs((prev) => prev.filter((item) => item.zone !== zone));
    } catch (error) {
      alert(error instanceof Error ? error.message : '删除区域失败');
    }
  }

  return (
    <div className="table">
      <form className="row" onSubmit={(event) => { event.preventDefault(); addZone(new FormData(event.currentTarget)); event.currentTarget.reset(); }}>
        <input name="zone" placeholder="新增区名，如 318区" />
        <select name="tier" defaultValue="三层看台">{tiers.map((tier) => <option key={tier}>{tier}</option>)}</select>
        <input name="rows" type="number" defaultValue={10} />
        <input name="max" type="number" defaultValue={20} />
        <input name="rowCounts" placeholder="每排号数：14,14,16" />
        <button className="btn">新增区域</button>
      </form>
      {zoneConfigs.map((config) => (
        <form className="row" key={config.zone} onSubmit={(event) => { event.preventDefault(); saveConfig(config.zone, new FormData(event.currentTarget)); }}>
          <input name="zone" defaultValue={config.zone} />
          <select name="tier" defaultValue={config.tier}>{tiers.map((tier) => <option key={tier}>{tier}</option>)}</select>
          <input name="rows" type="number" defaultValue={config.rowCounts.length} />
          <input name="max" type="number" defaultValue={Math.max(...config.rowCounts)} />
          <input name="rowCounts" defaultValue={config.rowCounts.join(',')} />
          <button className="btn secondary">保存</button>
          <button className="btn danger" type="button" onClick={() => removeZone(config.zone)}>删除</button>
        </form>
      ))}
    </div>
  );
}

function ProofAdmin({ proofFields, setProofFields }: { proofFields: ProofField[]; setProofFields: Props['setProofFields'] }) {
  async function addField(form: FormData) {
    const label = String(form.get('label')).trim();
    if (!label) return;
    const type = String(form.get('type')) as ProofFieldType;
    const options = splitOptions(String(form.get('options') ?? ''));
    try {
      const created = await addProofFieldToApi({ label, type, options });
      setProofFields((prev) => [...prev, { id: created.id, label, type, options, required: true }]);
    } catch (error) {
      alert(error instanceof Error ? error.message : '新增失败');
    }
  }
  return <div className="table"><form className="form" onSubmit={(event) => { event.preventDefault(); addField(new FormData(event.currentTarget)); event.currentTarget.reset(); }}><input name="label" placeholder="新增项名称" /><select name="type"><option value="image">图片上传</option><option value="text">填空</option><option value="radio">单选</option><option value="checkbox">多选</option></select><input name="options" placeholder="选项：是,否" /><button className="btn">新增</button></form>{proofFields.map((field) => <div className="row" key={field.id}><strong>{field.label}</strong><small>{proofFieldTypeLabel(field.type)}</small><button className="btn danger" onClick={async () => { try { await deleteProofFieldFromApi(field.id); setProofFields((prev) => prev.filter((item) => item.id !== field.id)); } catch (error) { alert(error instanceof Error ? error.message : '删除失败'); } }}>删除</button></div>)}</div>;
}
