'use client';

import { LoginOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, Divider, Flex, Form, Input, Result, Spin, Typography } from 'antd';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ErrorAlert } from '@/components/ErrorAlert';
import { Logo } from '@/components/Logo';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { isDesktop, openExternal } from '@/lib/desktop';

/** `?error=` codes from the Auth0 callback. */
const AUTH0_ERRORS: Record<string, string> = {
  not_registered: 'บัญชีนี้ยังไม่ได้ลงทะเบียน ติดต่อผู้ดูแลระบบ',
  email_unverified: 'กรุณายืนยันอีเมลกับ Auth0 ก่อนเข้าสู่ระบบ',
  auth0_failed: 'เข้าสู่ระบบด้วย Auth0 ไม่สำเร็จ กรุณาลองใหม่',
};

/** A browser login the desktop app is waiting on (POST /api/auth/auth0/desktop). */
interface Handoff {
  id: string;
  secret: string;
}

const desktopLoginUrl = (id: string) => `/api/auth/auth0/login?desktop=${encodeURIComponent(id)}`;
const HANDOFF_POLL_MS = 1500;
const HANDOFF_TIMEOUT_MS = 10 * 60_000;

export default function LoginPage() {
  const { user, login, loginWithToken } = useAuth();
  const router = useRouter();
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  // Desktop app: the login running in the default browser.
  const [handoff, setHandoff] = useState<Handoff | null>(null);
  // Browser tab the desktop app opened, back from Auth0: `{}` on success.
  const [desktopDone, setDesktopDone] = useState<{ error?: string } | null>(null);
  const providers = useQuery({ queryKey: ['auth-providers'], queryFn: () => api<{ auth0: boolean }>('/api/auth/providers') });

  useEffect(() => {
    if (user && !desktopDone) router.replace('/inbox');
  }, [user, desktopDone, router]);

  // Back from Auth0: the app token arrives in the fragment, errors in the query string.
  useEffect(() => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get('token');
    const query = new URLSearchParams(window.location.search);
    const code = query.get('error');
    if (query.get('desktop') === 'done') {
      window.history.replaceState(null, '', '/login');
      setDesktopDone({ error: code ? (AUTH0_ERRORS[code] ?? AUTH0_ERRORS.auth0_failed) : undefined });
      return;
    }
    if (!token && !code) return;
    window.history.replaceState(null, '', '/login');
    if (code) setError(AUTH0_ERRORS[code] ?? AUTH0_ERRORS.auth0_failed);
    if (token) {
      setBusy(true);
      loginWithToken(token)
        .catch(setError)
        .finally(() => setBusy(false));
    }
  }, [loginWithToken]);

  // Desktop app: wait for the browser login to finish, then sign in with the token it left behind.
  useEffect(() => {
    if (!handoff) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const deadline = Date.now() + HANDOFF_TIMEOUT_MS;
    const poll = async () => {
      try {
        const res = await api<{ token?: string; error?: string } | null>('/api/auth/auth0/desktop/claim', {
          method: 'POST',
          json: handoff,
        });
        if (stopped) return;
        if (!res) {
          if (Date.now() > deadline) throw new Error('การเข้าสู่ระบบหมดเวลา กรุณาลองใหม่');
          timer = setTimeout(poll, HANDOFF_POLL_MS);
          return;
        }
        if (res.token) await loginWithToken(res.token);
        else setError(AUTH0_ERRORS[res.error ?? ''] ?? AUTH0_ERRORS.auth0_failed);
        setHandoff(null);
      } catch (err) {
        if (stopped) return;
        setError(err);
        setHandoff(null);
      }
    };
    timer = setTimeout(poll, HANDOFF_POLL_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [handoff, loginWithToken]);

  async function startDesktopLogin() {
    setBusy(true);
    setError(null);
    try {
      const h = await api<Handoff>('/api/auth/auth0/desktop', { method: 'POST' });
      openExternal(desktopLoginUrl(h.id));
      setHandoff(h);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function submit(values: { email: string; password: string }) {
    setBusy(true);
    setError(null);
    try {
      await login(values.email, values.password);
      router.push('/inbox');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (desktopDone) {
    return (
      <Flex align="center" justify="center" style={{ minHeight: '100%', padding: 16 }}>
        <Card style={{ width: '100%', maxWidth: 380 }}>
          <Result
            status={desktopDone.error ? 'error' : 'success'}
            title={desktopDone.error ? 'เข้าสู่ระบบไม่สำเร็จ' : 'เข้าสู่ระบบสำเร็จ'}
            subTitle={desktopDone.error ? `${desktopDone.error} แล้วกลับไปลองใหม่ในแอป Hotline` : 'กลับไปที่แอป Hotline ได้เลย ปิดแท็บนี้ได้'}
          />
        </Card>
      </Flex>
    );
  }

  return (
    <Flex align="center" justify="center" style={{ minHeight: '100%', padding: 16 }}>
      <Card style={{ width: '100%', maxWidth: 380 }}>
        <Flex align="center" gap={12} style={{ marginBottom: 24 }}>
          <Logo size={40} />
          <div>
            <Typography.Title level={4} style={{ margin: 0 }}>
              Hotline
            </Typography.Title>
            <Typography.Text type="secondary">เข้าสู่ระบบสำหรับเจ้าหน้าที่</Typography.Text>
          </div>
        </Flex>
        <Form layout="vertical" onFinish={submit} requiredMark={false}>
          <Form.Item label="อีเมล" name="email" rules={[{ required: true, type: 'email', message: 'กรุณากรอกอีเมล' }]}>
            <Input type="email" autoComplete="username" />
          </Form.Item>
          <Form.Item label="รหัสผ่าน" name="password" rules={[{ required: true, message: 'กรุณากรอกรหัสผ่าน' }]}>
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <ErrorAlert error={error} />
          <Button type="primary" htmlType="submit" block loading={busy} disabled={!!handoff}>
            เข้าสู่ระบบ
          </Button>
        </Form>
        {providers.data?.auth0 && (
          <>
            <Divider plain>
              <Typography.Text type="secondary">หรือ</Typography.Text>
            </Divider>
            {handoff ? (
              <Flex vertical align="center" gap={8}>
                <Typography.Text type="secondary">
                  <Spin size="small" style={{ marginRight: 8 }} />
                  กำลังรอเข้าสู่ระบบในเบราว์เซอร์…
                </Typography.Text>
                <Flex gap={8}>
                  <Button size="small" onClick={() => openExternal(desktopLoginUrl(handoff.id))}>
                    เปิดเบราว์เซอร์อีกครั้ง
                  </Button>
                  <Button size="small" onClick={() => setHandoff(null)}>
                    ยกเลิก
                  </Button>
                </Flex>
              </Flex>
            ) : (
              <Button
                block
                icon={<LoginOutlined />}
                href="/api/auth/auth0/login"
                disabled={busy}
                onClick={(e) => {
                  // The desktop app signs in through the default browser instead of its own window.
                  if (!isDesktop()) return;
                  e.preventDefault();
                  void startDesktopLogin();
                }}
              >
                เข้าสู่ระบบด้วย Auth0
              </Button>
            )}
          </>
        )}
      </Card>
    </Flex>
  );
}
