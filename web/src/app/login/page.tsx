'use client';

import { LoginOutlined, MessageOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, Divider, Flex, Form, Input, Typography } from 'antd';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ErrorAlert } from '@/components/ErrorAlert';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/** `?error=` codes from the Auth0 callback. */
const AUTH0_ERRORS: Record<string, string> = {
  not_registered: 'บัญชีนี้ยังไม่ได้ลงทะเบียน ติดต่อผู้ดูแลระบบ',
  email_unverified: 'กรุณายืนยันอีเมลกับ Auth0 ก่อนเข้าสู่ระบบ',
  auth0_failed: 'เข้าสู่ระบบด้วย Auth0 ไม่สำเร็จ กรุณาลองใหม่',
};

export default function LoginPage() {
  const { user, login, loginWithToken } = useAuth();
  const router = useRouter();
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const providers = useQuery({ queryKey: ['auth-providers'], queryFn: () => api<{ auth0: boolean }>('/api/auth/providers') });

  useEffect(() => {
    if (user) router.replace('/inbox');
  }, [user, router]);

  // Back from Auth0: the app token arrives in the fragment, errors in the query string.
  useEffect(() => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get('token');
    const code = new URLSearchParams(window.location.search).get('error');
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

  return (
    <Flex align="center" justify="center" style={{ minHeight: '100%', padding: 16 }}>
      <Card style={{ width: '100%', maxWidth: 380 }}>
        <Flex align="center" gap={12} style={{ marginBottom: 24 }}>
          <Flex
            align="center"
            justify="center"
            style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--brand)', color: '#fff', fontSize: 20 }}
          >
            <MessageOutlined />
          </Flex>
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
          <Button type="primary" htmlType="submit" block loading={busy}>
            เข้าสู่ระบบ
          </Button>
        </Form>
        {providers.data?.auth0 && (
          <>
            <Divider plain>
              <Typography.Text type="secondary">หรือ</Typography.Text>
            </Divider>
            <Button block icon={<LoginOutlined />} href="/api/auth/auth0/login" disabled={busy}>
              เข้าสู่ระบบด้วย Auth0
            </Button>
          </>
        )}
      </Card>
    </Flex>
  );
}
