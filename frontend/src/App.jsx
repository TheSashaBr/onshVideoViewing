import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import Room from './pages/Room';
import ErrorPage from './pages/ErrorPage';
import ErrorBoundary from './components/ErrorBoundary';
import ToastContainer from './components/ToastContainer';

function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <ToastContainer />
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/room/:roomId" element={<Room />} />
          <Route path="*" element={<ErrorPage notFound />} />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  );
}

export default App;
